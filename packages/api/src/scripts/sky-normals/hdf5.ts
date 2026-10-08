import { inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// A small, strict, read-only HDF5 reader for the sky normals generator
// (T-647).
//
// HadUK-Grid ships NetCDF-4 files, which are HDF5 files. No HDF5 library is
// part of this repository's stack, so the generator reads them with this
// module, written to the HDF5 File Format Specification (version 3.0,
// https://docs.hdfgroup.org/hdf5/develop/_f_m_t3.html). It implements only
// what those files use, and refuses everything else by name rather than
// guessing:
// - superblock versions 2 and 3;
// - object headers versions 1 and 2, with continuation blocks;
// - new-style groups: compact links, and dense links in a fractal heap
//   indexed by a version 2 B-tree;
// - attributes, compact and dense (fractal heap + version 2 B-tree);
// - fixed-point, floating-point, fixed-length string and variable-length
//   string datatypes (strings through the global heap);
// - contiguous, compact and chunked layouts (layout message version 3,
//   version 1 B-tree chunk index; version 4 single-chunk index);
// - the deflate, shuffle and Fletcher-32 filters.
//
// The generator pins every input file by sha256, so this reader only ever
// meets bytes that have been checked against the published files.
// ---------------------------------------------------------------------------

export class Hdf5FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Hdf5FormatError";
  }
}

function fail(message: string): never {
  throw new Hdf5FormatError(message);
}

const SIGNATURE = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

const MSG_DATASPACE = 0x01;
const MSG_LINK_INFO = 0x02;
const MSG_DATATYPE = 0x03;
const MSG_LINK = 0x06;
const MSG_LAYOUT = 0x08;
const MSG_FILTER_PIPELINE = 0x0b;
const MSG_ATTRIBUTE = 0x0c;
const MSG_CONTINUATION = 0x10;
const MSG_SYMBOL_TABLE = 0x11;
const MSG_ATTRIBUTE_INFO = 0x15;

const FILTER_DEFLATE = 1;
const FILTER_SHUFFLE = 2;
const FILTER_FLETCHER32 = 3;

/** Unsigned little-endian integer of 1 to 8 bytes. */
function readUint(buf: Buffer, pos: number, size: number): number {
  if (pos < 0 || size < 1 || size > 8 || pos + size > buf.length) fail(`read of ${String(size)} bytes at ${String(pos)} is outside the file`);
  if (size === 8) {
    const value = buf.readBigUInt64LE(pos);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`64-bit value at ${String(pos)} is too large`);
    return Number(value);
  }
  let value = 0;
  for (let i = size - 1; i >= 0; i -= 1) value = value * 256 + (buf[pos + i] ?? 0);
  return value;
}

function isUndefinedAddress(buf: Buffer, pos: number, size: number): boolean {
  for (let i = 0; i < size; i += 1) if (buf[pos + i] !== 0xff) return false;
  return true;
}

function signatureAt(buf: Buffer, pos: number, text: string): boolean {
  return pos >= 0 && pos + text.length <= buf.length && buf.toString("latin1", pos, pos + text.length) === text;
}

/** floor(log2(n)) for a positive integer. */
function log2Floor(n: number): number {
  if (!Number.isFinite(n) || n < 1) fail(`log2 of ${String(n)}`);
  return Math.floor(Math.log2(n));
}

interface Message {
  readonly type: number;
  readonly flags: number;
  readonly data: Buffer;
}

export type DatatypeClass = "fixed" | "float" | "string" | "vlen-string" | "other";

export interface Datatype {
  readonly kind: DatatypeClass;
  readonly size: number;
  readonly littleEndian: boolean;
  readonly signed: boolean;
  /** For strings: 0 null-terminated, 1 null-padded, 2 space-padded. */
  readonly padding: number;
}

interface Layout {
  readonly kind: "compact" | "contiguous" | "chunked";
  readonly address: number | null;
  readonly size: number;
  readonly compactData: Buffer | null;
  readonly chunkDims: readonly number[];
  readonly index: { readonly type: "btree-v1"; readonly address: number }
    | { readonly type: "single"; readonly address: number; readonly filteredSize: number | null; readonly filterMask: number }
    | null;
}

interface Filter {
  readonly id: number;
  readonly clientData: readonly number[];
}

export type AttributeValue = string | readonly number[] | null;

interface FractalHeap {
  readonly address: number;
  readonly heapIdLength: number;
  readonly flags: number;
  readonly maxManagedObjectSize: number;
  readonly tableWidth: number;
  readonly startingBlockSize: number;
  readonly maxDirectBlockSize: number;
  readonly maxHeapSizeBits: number;
  readonly rootBlockAddress: number | null;
  readonly currentRootRows: number;
}

export class Hdf5File {
  readonly buf: Buffer;
  readonly offsetSize: number;
  readonly lengthSize: number;
  private readonly baseAddress: number;
  private readonly rootAddress: number;

  constructor(buf: Buffer) {
    this.buf = buf;
    if (!buf.subarray(0, 8).equals(SIGNATURE)) fail("not an HDF5 file: signature missing at offset 0");
    const version = buf[8];
    if (version !== 2 && version !== 3) fail(`superblock version ${String(version)} is not supported`);
    this.offsetSize = buf[9] ?? 0;
    this.lengthSize = buf[10] ?? 0;
    if (![2, 4, 8].includes(this.offsetSize) || ![2, 4, 8].includes(this.lengthSize)) fail("unsupported offset or length size");
    let pos = 12;
    this.baseAddress = readUint(buf, pos, this.offsetSize);
    pos += this.offsetSize * 2; // base address, superblock extension address
    const endOfFile = readUint(buf, pos, this.offsetSize);
    pos += this.offsetSize;
    this.rootAddress = readUint(buf, pos, this.offsetSize);
    if (endOfFile !== buf.length) fail(`end-of-file address ${String(endOfFile)} does not match the file length ${String(buf.length)}`);
  }

  root(): Hdf5Group {
    return new Hdf5Group(this, this.rootAddress, "/");
  }

  // --- low-level helpers -------------------------------------------------

  address(pos: number): number | null {
    if (isUndefinedAddress(this.buf, pos, this.offsetSize)) return null;
    return this.baseAddress + readUint(this.buf, pos, this.offsetSize);
  }

  requireAddress(pos: number, what: string): number {
    const address = this.address(pos);
    if (address === null) fail(`${what} has no address`);
    return address;
  }

  length(pos: number): number {
    return readUint(this.buf, pos, this.lengthSize);
  }

  // --- object headers ----------------------------------------------------

  objectHeader(address: number): Message[] {
    if (signatureAt(this.buf, address, "OHDR")) return this.objectHeaderV2(address);
    if (this.buf[address] === 1) return this.objectHeaderV1(address);
    fail(`no object header at ${String(address)}`);
  }

  private objectHeaderV2(address: number): Message[] {
    const buf = this.buf;
    if (buf[address + 4] !== 2) fail(`object header version ${String(buf[address + 4])} at ${String(address)}`);
    const flags = buf[address + 5] ?? 0;
    let pos = address + 6;
    if ((flags & 0x20) !== 0) pos += 16;
    if ((flags & 0x10) !== 0) pos += 4;
    const chunkSizeBytes = 1 << (flags & 0x03);
    const chunkSize = readUint(buf, pos, chunkSizeBytes);
    pos += chunkSizeBytes;
    const headerSize = (flags & 0x04) !== 0 ? 6 : 4;
    const messages: Message[] = [];
    const pending: { start: number; end: number }[] = [{ start: pos, end: pos + chunkSize }];
    while (pending.length > 0) {
      const block = pending.shift();
      if (block === undefined) break;
      let at = block.start;
      while (block.end - at >= headerSize) {
        const type = buf[at] ?? 0;
        const size = readUint(buf, at + 1, 2);
        const messageFlags = buf[at + 3] ?? 0;
        const dataStart = at + headerSize;
        if (dataStart + size > block.end) fail(`message overruns its object header block at ${String(at)}`);
        const data = buf.subarray(dataStart, dataStart + size);
        if (type === MSG_CONTINUATION) {
          const continuation = this.requireAddress(dataStart, "object header continuation");
          const continuationLength = readUint(buf, dataStart + this.offsetSize, this.lengthSize);
          if (!signatureAt(buf, continuation, "OCHK")) fail(`continuation block at ${String(continuation)} lacks OCHK`);
          pending.push({ start: continuation + 4, end: continuation + continuationLength - 4 });
        } else {
          messages.push({ type, flags: messageFlags, data });
        }
        at = dataStart + size;
      }
    }
    return messages;
  }

  private objectHeaderV1(address: number): Message[] {
    const buf = this.buf;
    const total = readUint(buf, address + 2, 2);
    const headerSize = readUint(buf, address + 8, 4);
    const messages: Message[] = [];
    const pending: { start: number; end: number }[] = [{ start: address + 16, end: address + 16 + headerSize }];
    let seen = 0;
    while (pending.length > 0 && seen < total) {
      const block = pending.shift();
      if (block === undefined) break;
      let at = block.start;
      while (block.end - at >= 8 && seen < total) {
        const type = readUint(buf, at, 2);
        const size = readUint(buf, at + 2, 2);
        const messageFlags = buf[at + 4] ?? 0;
        const dataStart = at + 8;
        if (dataStart + size > block.end) fail(`message overruns its object header block at ${String(at)}`);
        const data = buf.subarray(dataStart, dataStart + size);
        seen += 1;
        if (type === MSG_CONTINUATION) {
          const continuation = this.requireAddress(dataStart, "object header continuation");
          pending.push({ start: continuation, end: continuation + readUint(buf, dataStart + this.offsetSize, this.lengthSize) });
        } else {
          messages.push({ type, flags: messageFlags, data });
        }
        at = dataStart + size;
      }
    }
    return messages;
  }

  // --- fractal heaps -----------------------------------------------------

  fractalHeap(address: number): FractalHeap {
    const buf = this.buf;
    if (!signatureAt(buf, address, "FRHP")) fail(`no fractal heap at ${String(address)}`);
    if (buf[address + 4] !== 0) fail("fractal heap version is not 0");
    const O = this.offsetSize;
    const L = this.lengthSize;
    let pos = address + 5;
    const heapIdLength = readUint(buf, pos, 2);
    const filtersLength = readUint(buf, pos + 2, 2);
    const flags = buf[pos + 4] ?? 0;
    const maxManagedObjectSize = readUint(buf, pos + 5, 4);
    pos += 9;
    pos += L + O + L + O + L + L + L + L + L + L + L + L;
    const tableWidth = readUint(buf, pos, 2);
    pos += 2;
    const startingBlockSize = this.length(pos);
    pos += L;
    const maxDirectBlockSize = this.length(pos);
    pos += L;
    const maxHeapSizeBits = readUint(buf, pos, 2);
    pos += 2 + 2; // maximum heap size, starting # of rows in root indirect block
    const rootBlockAddress = this.address(pos);
    pos += O;
    const currentRootRows = readUint(buf, pos, 2);
    if (filtersLength !== 0) fail("filtered fractal heaps are not supported");
    return { address, heapIdLength, flags, maxManagedObjectSize, tableWidth, startingBlockSize, maxDirectBlockSize, maxHeapSizeBits, rootBlockAddress, currentRootRows };
  }

  heapObject(heap: FractalHeap, heapId: Buffer): Buffer {
    const type = ((heapId[0] ?? 0) >> 4) & 0x03;
    if (((heapId[0] ?? 0) >> 6) !== 0) fail("heap ID version is not 0");
    if (type === 2) {
      const length = ((heapId[0] ?? 0) & 0x0f) + 1;
      return heapId.subarray(1, 1 + length);
    }
    if (type !== 0) fail("huge fractal heap objects are not supported");
    const offsetBytes = Math.ceil(heap.maxHeapSizeBits / 8);
    const lengthBytes = Math.min(
      Math.floor((log2Floor(heap.maxDirectBlockSize) + 7) / 8),
      Math.floor((log2Floor(heap.maxManagedObjectSize) + 7) / 8),
    );
    if (1 + offsetBytes + lengthBytes > heapId.length) fail("heap ID is shorter than its fields");
    const offset = readUint(heapId, 1, offsetBytes);
    const length = readUint(heapId, 1 + offsetBytes, lengthBytes);
    const block = this.directBlockFor(heap, offset);
    const start = block.address + (offset - block.blockOffset);
    if (offset + length > block.blockOffset + block.size) fail("heap object crosses its direct block");
    return this.buf.subarray(start, start + length);
  }

  private directBlockFor(heap: FractalHeap, offset: number): { address: number; blockOffset: number; size: number } {
    if (heap.rootBlockAddress === null) fail("fractal heap has no root block");
    if (heap.currentRootRows === 0) {
      this.checkDirectBlock(heap, heap.rootBlockAddress, 0);
      return { address: heap.rootBlockAddress, blockOffset: 0, size: heap.startingBlockSize };
    }
    return this.searchIndirectBlock(heap, heap.rootBlockAddress, heap.currentRootRows, 0, offset);
  }

  private checkDirectBlock(heap: FractalHeap, address: number, expectedOffset: number): void {
    if (!signatureAt(this.buf, address, "FHDB")) fail(`no direct heap block at ${String(address)}`);
    const offsetBytes = Math.ceil(heap.maxHeapSizeBits / 8);
    const blockOffset = readUint(this.buf, address + 5 + this.offsetSize, offsetBytes);
    if (blockOffset !== expectedOffset) fail("direct heap block offset does not match its position");
  }

  private searchIndirectBlock(heap: FractalHeap, address: number, rows: number, baseOffset: number, offset: number): { address: number; blockOffset: number; size: number } {
    if (!signatureAt(this.buf, address, "FHIB")) fail(`no indirect heap block at ${String(address)}`);
    const offsetBytes = Math.ceil(heap.maxHeapSizeBits / 8);
    let pos = address + 5 + this.offsetSize + offsetBytes;
    const maxDirectRows = log2Floor(heap.maxDirectBlockSize) - log2Floor(heap.startingBlockSize) + 2;
    let blockOffset = baseOffset;
    for (let row = 0; row < rows; row += 1) {
      const rowSize = row < 2 ? heap.startingBlockSize : heap.startingBlockSize * 2 ** (row - 1);
      for (let col = 0; col < heap.tableWidth; col += 1) {
        const child = this.address(pos);
        pos += this.offsetSize;
        if (child !== null && offset >= blockOffset && offset < blockOffset + rowSize) {
          if (row < maxDirectRows) {
            this.checkDirectBlock(heap, child, blockOffset);
            return { address: child, blockOffset, size: rowSize };
          }
          const childRows = log2Floor(rowSize) - log2Floor(heap.startingBlockSize * heap.tableWidth) + 1;
          return this.searchIndirectBlock(heap, child, childRows, blockOffset, offset);
        }
        blockOffset += rowSize;
      }
    }
    fail(`heap offset ${String(offset)} is not in any block`);
  }

  // --- version 2 B-trees -------------------------------------------------

  btreeV2Records(address: number): Buffer[] {
    const buf = this.buf;
    if (!signatureAt(buf, address, "BTHD")) fail(`no version 2 B-tree at ${String(address)}`);
    const O = this.offsetSize;
    const nodeSize = readUint(buf, address + 6, 4);
    const recordSize = readUint(buf, address + 10, 2);
    const depth = readUint(buf, address + 12, 2);
    const rootAddress = this.address(address + 16);
    const rootRecords = readUint(buf, address + 16 + O, 2);
    if (rootAddress === null || rootRecords === 0) return [];
    // Node geometry (H5B2hdr.c): records per leaf, and the sizes of the
    // record-count fields in internal nodes.
    const prefix = 10;
    const encSize = (n: number): number => Math.floor(log2Floor(Math.max(1, n)) / 8) + 1;
    const leafMax = Math.floor((nodeSize - prefix) / recordSize);
    const maxNrecSize = encSize(leafMax);
    const cumMaxNrec: number[] = [leafMax];
    const cumMaxNrecSize: number[] = [0];
    for (let level = 1; level <= depth; level += 1) {
      const pointerSize = O + maxNrecSize + (level > 1 ? (cumMaxNrecSize[level - 1] ?? 0) : 0);
      const maxRecords = Math.floor((nodeSize - (prefix + pointerSize)) / (recordSize + pointerSize));
      const cumulative = (maxRecords + 1) * (cumMaxNrec[level - 1] ?? 0) + maxRecords;
      cumMaxNrec.push(cumulative);
      cumMaxNrecSize.push(encSize(cumulative));
    }
    const records: Buffer[] = [];
    const visit = (node: number, count: number, level: number): void => {
      const signature = level === 0 ? "BTLF" : "BTIN";
      if (!signatureAt(buf, node, signature)) fail(`expected ${signature} at ${String(node)}`);
      let pos = node + 6;
      for (let i = 0; i < count; i += 1) {
        records.push(buf.subarray(pos, pos + recordSize));
        pos += recordSize;
      }
      if (level === 0) return;
      for (let i = 0; i <= count; i += 1) {
        const child = this.requireAddress(pos, "B-tree child");
        pos += O;
        const childCount = readUint(buf, pos, maxNrecSize);
        pos += maxNrecSize;
        if (level > 1) pos += cumMaxNrecSize[level - 1] ?? 0;
        visit(child, childCount, level - 1);
      }
    };
    visit(rootAddress, rootRecords, depth);
    return records;
  }

  // --- global heap (variable-length data) --------------------------------

  globalHeapObject(collection: number, index: number): Buffer {
    const buf = this.buf;
    if (!signatureAt(buf, collection, "GCOL")) fail(`no global heap collection at ${String(collection)}`);
    const size = this.length(collection + 8);
    let pos = collection + 8 + this.lengthSize;
    const end = collection + size;
    while (pos + 8 + this.lengthSize <= end) {
      const objectIndex = readUint(buf, pos, 2);
      const objectSize = this.length(pos + 8);
      const data = pos + 8 + this.lengthSize;
      if (objectIndex === index) return buf.subarray(data, data + objectSize);
      if (objectIndex === 0) break;
      pos = data + Math.ceil(objectSize / 8) * 8;
    }
    fail(`global heap object ${String(index)} not found`);
  }
}

// ---------------------------------------------------------------------------
// Message decoders
// ---------------------------------------------------------------------------

function decodeDatatype(data: Buffer): Datatype {
  const classAndVersion = data[0] ?? 0;
  const typeClass = classAndVersion & 0x0f;
  const bits0 = data[1] ?? 0;
  const bits1 = data[2] ?? 0;
  const size = readUint(data, 4, 4);
  switch (typeClass) {
    case 0:
      return { kind: "fixed", size, littleEndian: (bits0 & 0x01) === 0, signed: (bits0 & 0x08) !== 0, padding: 0 };
    case 1:
      if ((bits0 & 0x40) !== 0) fail("VAX floating-point byte order is not supported");
      return { kind: "float", size, littleEndian: (bits0 & 0x01) === 0, signed: true, padding: 0 };
    case 3:
      return { kind: "string", size, littleEndian: true, signed: false, padding: bits0 & 0x0f };
    case 9:
      if ((bits0 & 0x0f) === 1) return { kind: "vlen-string", size, littleEndian: true, signed: false, padding: (bits0 >> 4) & 0x0f };
      return { kind: "other", size, littleEndian: true, signed: false, padding: bits1 };
    default:
      return { kind: "other", size, littleEndian: true, signed: false, padding: 0 };
  }
}

function decodeDataspace(data: Buffer, lengthSize: number): number[] | null {
  const version = data[0] ?? 0;
  const rank = data[1] ?? 0;
  let pos: number;
  if (version === 1) {
    pos = 8;
  } else if (version === 2) {
    const type = data[3] ?? 0;
    if (type === 2) return null; // null dataspace: no elements
    pos = 4;
  } else {
    fail(`dataspace version ${String(version)}`);
  }
  const dims: number[] = [];
  for (let i = 0; i < rank; i += 1) {
    dims.push(readUint(data, pos, lengthSize));
    pos += lengthSize;
  }
  return dims;
}

function elementCount(dims: readonly number[]): number {
  return dims.reduce((product, n) => product * n, 1);
}

function decodeNumber(buf: Buffer, pos: number, type: Datatype): number {
  if (type.kind === "float") {
    if (type.size === 8) return type.littleEndian ? buf.readDoubleLE(pos) : buf.readDoubleBE(pos);
    if (type.size === 4) return type.littleEndian ? buf.readFloatLE(pos) : buf.readFloatBE(pos);
    fail(`floating-point size ${String(type.size)}`);
  }
  if (type.kind === "fixed") {
    const n = type.size;
    if (n === 1) return type.signed ? buf.readInt8(pos) : buf.readUInt8(pos);
    if (n === 2) return type.signed ? (type.littleEndian ? buf.readInt16LE(pos) : buf.readInt16BE(pos)) : (type.littleEndian ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos));
    if (n === 4) return type.signed ? (type.littleEndian ? buf.readInt32LE(pos) : buf.readInt32BE(pos)) : (type.littleEndian ? buf.readUInt32LE(pos) : buf.readUInt32BE(pos));
    if (n === 8) {
      const big = type.signed ? (type.littleEndian ? buf.readBigInt64LE(pos) : buf.readBigInt64BE(pos)) : (type.littleEndian ? buf.readBigUInt64LE(pos) : buf.readBigUInt64BE(pos));
      const value = Number(big);
      if (!Number.isSafeInteger(value)) fail("64-bit integer value is not exactly representable");
      return value;
    }
    fail(`fixed-point size ${String(n)}`);
  }
  fail(`datatype ${type.kind} is not numeric`);
}

function decodeFixedString(bytes: Buffer, type: Datatype): string {
  let text = bytes.toString("utf8");
  if (type.padding === 0 || type.padding === 1) {
    const nul = text.indexOf("\u0000");
    if (nul >= 0) text = text.slice(0, nul);
  } else if (type.padding === 2) {
    text = text.replace(/ +$/u, "");
  }
  return text;
}

// ---------------------------------------------------------------------------
// Groups, datasets and attributes
// ---------------------------------------------------------------------------

abstract class Hdf5Object {
  protected readonly file: Hdf5File;
  readonly address: number;
  readonly path: string;
  protected readonly messages: Message[];
  private attributeCache: Map<string, { type: Datatype; dims: number[] | null; data: Buffer }> | null = null;

  constructor(file: Hdf5File, address: number, path: string) {
    this.file = file;
    this.address = address;
    this.path = path;
    this.messages = file.objectHeader(address);
  }

  protected message(type: number): Message | undefined {
    return this.messages.find((message) => message.type === type);
  }

  private attributes(): Map<string, { type: Datatype; dims: number[] | null; data: Buffer }> {
    if (this.attributeCache !== null) return this.attributeCache;
    const found = new Map<string, { type: Datatype; dims: number[] | null; data: Buffer }>();
    const add = (body: Buffer): void => {
      const parsed = this.decodeAttribute(body);
      found.set(parsed.name, parsed);
    };
    for (const message of this.messages) if (message.type === MSG_ATTRIBUTE) add(message.data);
    const info = this.message(MSG_ATTRIBUTE_INFO);
    if (info !== undefined) {
      const O = this.file.offsetSize;
      const flags = info.data[1] ?? 0;
      let pos = 2 + ((flags & 0x01) !== 0 ? 2 : 0);
      const heapAddress = this.file.address(this.absolute(info.data, pos));
      pos += O;
      const nameIndex = this.file.address(this.absolute(info.data, pos));
      if (heapAddress !== null && nameIndex !== null) {
        const heap = this.file.fractalHeap(heapAddress);
        for (const record of this.file.btreeV2Records(nameIndex)) add(this.file.heapObject(heap, record.subarray(0, 8)));
      }
    }
    this.attributeCache = found;
    return found;
  }

  /** Position of `data[pos]` in the file buffer (messages are views). */
  protected absolute(data: Buffer, pos: number): number {
    return data.byteOffset - this.file.buf.byteOffset + pos;
  }

  private decodeAttribute(body: Buffer): { name: string; type: Datatype; dims: number[] | null; data: Buffer } {
    const version = body[0] ?? 0;
    const flags = body[1] ?? 0;
    if ((flags & 0x03) !== 0) fail("shared attribute datatypes or dataspaces are not supported");
    const nameSize = readUint(body, 2, 2);
    const typeSize = readUint(body, 4, 2);
    const spaceSize = readUint(body, 6, 2);
    let pos = 8;
    const pad = (n: number): number => (version === 1 ? Math.ceil(n / 8) * 8 : n);
    if (version === 3) pos += 1;
    else if (version !== 1 && version !== 2) fail(`attribute message version ${String(version)}`);
    const name = body.toString("utf8", pos, pos + nameSize).replace(/\u0000+$/u, "");
    pos += pad(nameSize);
    const type = decodeDatatype(body.subarray(pos, pos + typeSize));
    pos += pad(typeSize);
    const dims = decodeDataspace(body.subarray(pos, pos + spaceSize), this.file.lengthSize);
    pos += pad(spaceSize);
    return { name, type, dims, data: body.subarray(pos) };
  }

  attributeNames(): string[] {
    return [...this.attributes().keys()].sort();
  }

  /** A string or numeric attribute's value; null when absent. Other
   *  attribute types (references, compounds) are reported as unsupported
   *  only when asked for. */
  attribute(name: string): AttributeValue {
    const attribute = this.attributes().get(name);
    if (attribute === undefined) return null;
    const { type, dims, data } = attribute;
    const count = dims === null ? 0 : elementCount(dims);
    if (type.kind === "string") {
      if (count !== 1) fail(`string attribute ${name} has ${String(count)} elements`);
      return decodeFixedString(data.subarray(0, type.size), type);
    }
    if (type.kind === "vlen-string") {
      if (count !== 1) fail(`string attribute ${name} has ${String(count)} elements`);
      const length = readUint(data, 0, 4);
      const collection = this.file.address(this.absolute(data, 4));
      if (collection === null) return "";
      const index = readUint(data, 4 + this.file.offsetSize, 4);
      return this.file.globalHeapObject(collection, index).subarray(0, length).toString("utf8");
    }
    if (type.kind === "float" || type.kind === "fixed") {
      const values: number[] = [];
      for (let i = 0; i < count; i += 1) values.push(decodeNumber(data, i * type.size, type));
      return values;
    }
    fail(`attribute ${name} has an unsupported datatype`);
  }

  numberAttribute(name: string): number | null {
    const value = this.attribute(name);
    if (value === null) return null;
    if (typeof value === "string" || value.length !== 1) fail(`attribute ${name} is not a single number`);
    return value[0] ?? null;
  }

  stringAttribute(name: string): string | null {
    const value = this.attribute(name);
    if (value === null) return null;
    if (typeof value !== "string") fail(`attribute ${name} is not a string`);
    return value;
  }
}

export class Hdf5Group extends Hdf5Object {
  private linkCache: Map<string, number> | null = null;

  links(): Map<string, number> {
    if (this.linkCache !== null) return this.linkCache;
    if (this.message(MSG_SYMBOL_TABLE) !== undefined) fail("old-style (symbol table) groups are not supported");
    const links = new Map<string, number>();
    const add = (body: Buffer): void => {
      const link = this.decodeLink(body);
      if (link !== null) links.set(link.name, link.address);
    };
    for (const message of this.messages) if (message.type === MSG_LINK) add(message.data);
    const info = this.message(MSG_LINK_INFO);
    if (info !== undefined) {
      const flags = info.data[1] ?? 0;
      let pos = 2 + ((flags & 0x01) !== 0 ? 8 : 0);
      const heapAddress = this.file.address(this.absolute(info.data, pos));
      pos += this.file.offsetSize;
      const nameIndex = this.file.address(this.absolute(info.data, pos));
      if (heapAddress !== null && nameIndex !== null) {
        const heap = this.file.fractalHeap(heapAddress);
        for (const record of this.file.btreeV2Records(nameIndex)) add(this.file.heapObject(heap, record.subarray(4, 4 + heap.heapIdLength)));
      }
    }
    this.linkCache = links;
    return links;
  }

  private decodeLink(body: Buffer): { name: string; address: number } | null {
    if (body[0] !== 1) fail(`link message version ${String(body[0])}`);
    const flags = body[1] ?? 0;
    let pos = 2;
    let linkType = 0;
    if ((flags & 0x08) !== 0) {
      linkType = body[pos] ?? 0;
      pos += 1;
    }
    if ((flags & 0x04) !== 0) pos += 8;
    if ((flags & 0x10) !== 0) pos += 1;
    const nameLengthBytes = 1 << (flags & 0x03);
    const nameLength = readUint(body, pos, nameLengthBytes);
    pos += nameLengthBytes;
    const name = body.toString("utf8", pos, pos + nameLength);
    pos += nameLength;
    if (linkType !== 0) return null; // soft and external links are not followed
    return { name, address: this.file.requireAddress(this.absolute(body, pos), `link ${name}`) };
  }

  dataset(name: string): Hdf5Dataset {
    const address = this.links().get(name);
    if (address === undefined) fail(`no object named ${name} in ${this.path}`);
    return new Hdf5Dataset(this.file, address, `${this.path}${name}`);
  }

  has(name: string): boolean {
    return this.links().has(name);
  }
}

export class Hdf5Dataset extends Hdf5Object {
  readonly shape: readonly number[];
  readonly type: Datatype;
  private readonly layout: Layout;
  private readonly filters: readonly Filter[];
  private chunkIndex: Map<string, { address: number; size: number; filterMask: number }> | null = null;
  private readonly chunkCache = new Map<string, Buffer | null>();

  constructor(file: Hdf5File, address: number, path: string) {
    super(file, address, path);
    const space = this.message(MSG_DATASPACE);
    const type = this.message(MSG_DATATYPE);
    const layout = this.message(MSG_LAYOUT);
    if (space === undefined || type === undefined || layout === undefined) fail(`${path} is not a dataset`);
    if ((type.flags & 0x02) !== 0) fail(`${path} uses a shared (committed) datatype`);
    this.shape = decodeDataspace(space.data, file.lengthSize) ?? [];
    this.type = decodeDatatype(type.data);
    this.layout = this.decodeLayout(layout.data);
    const pipeline = this.message(MSG_FILTER_PIPELINE);
    this.filters = pipeline === undefined ? [] : this.decodeFilters(pipeline.data);
    for (const filter of this.filters) {
      if (![FILTER_DEFLATE, FILTER_SHUFFLE, FILTER_FLETCHER32].includes(filter.id)) fail(`${path} uses unsupported filter ${String(filter.id)}`);
    }
  }

  private decodeLayout(data: Buffer): Layout {
    const version = data[0] ?? 0;
    const layoutClass = data[1] ?? 0;
    const O = this.file.offsetSize;
    if (version !== 3 && version !== 4) fail(`${this.path}: layout message version ${String(version)}`);
    if (layoutClass === 0) {
      const size = readUint(data, 2, 2);
      return { kind: "compact", address: null, size, compactData: data.subarray(4, 4 + size), chunkDims: [], index: null };
    }
    if (layoutClass === 1) {
      return { kind: "contiguous", address: this.file.address(this.absolute(data, 2)), size: readUint(data, 2 + O, this.file.lengthSize), compactData: null, chunkDims: [], index: null };
    }
    if (layoutClass !== 2) fail(`${this.path}: layout class ${String(layoutClass)}`);
    if (version === 3) {
      const dimensionality = data[2] ?? 0;
      const btree = this.file.requireAddress(this.absolute(data, 3), `${this.path} chunk index`);
      const dims: number[] = [];
      for (let i = 0; i < dimensionality; i += 1) dims.push(readUint(data, 3 + O + i * 4, 4));
      return { kind: "chunked", address: null, size: 0, compactData: null, chunkDims: dims.slice(0, -1), index: { type: "btree-v1", address: btree } };
    }
    const flags = data[2] ?? 0;
    const dimensionality = data[3] ?? 0;
    const encoded = data[4] ?? 0;
    const dims: number[] = [];
    let pos = 5;
    for (let i = 0; i < dimensionality; i += 1) {
      dims.push(readUint(data, pos, encoded));
      pos += encoded;
    }
    const indexType = data[pos] ?? 0;
    pos += 1;
    if (indexType !== 1) fail(`${this.path}: chunk index type ${String(indexType)} is not supported`);
    let filteredSize: number | null = null;
    let filterMask = 0;
    if ((flags & 0x02) !== 0) {
      filteredSize = readUint(data, pos, this.file.lengthSize);
      filterMask = readUint(data, pos + this.file.lengthSize, 4);
      pos += this.file.lengthSize + 4;
    }
    const address = this.file.requireAddress(this.absolute(data, pos), `${this.path} chunk`);
    const chunkDims = dims.length === this.shape.length + 1 ? dims.slice(0, -1) : dims;
    return { kind: "chunked", address: null, size: 0, compactData: null, chunkDims, index: { type: "single", address, filteredSize, filterMask } };
  }

  private decodeFilters(data: Buffer): Filter[] {
    const version = data[0] ?? 0;
    const count = data[1] ?? 0;
    const filters: Filter[] = [];
    let pos = version === 1 ? 8 : 2;
    if (version !== 1 && version !== 2) fail(`${this.path}: filter pipeline version ${String(version)}`);
    for (let i = 0; i < count; i += 1) {
      const id = readUint(data, pos, 2);
      pos += 2;
      let nameLength = 0;
      if (version === 1 || id >= 256) {
        nameLength = readUint(data, pos, 2);
        pos += 2;
      }
      pos += 2; // flags
      const values = readUint(data, pos, 2);
      pos += 2;
      pos += version === 1 ? Math.ceil(nameLength / 8) * 8 : nameLength;
      const clientData: number[] = [];
      for (let v = 0; v < values; v += 1) {
        clientData.push(readUint(data, pos, 4));
        pos += 4;
      }
      if (version === 1 && values % 2 === 1) pos += 4;
      filters.push({ id, clientData });
    }
    return filters;
  }

  private chunks(): Map<string, { address: number; size: number; filterMask: number }> {
    if (this.chunkIndex !== null) return this.chunkIndex;
    const index = new Map<string, { address: number; size: number; filterMask: number }>();
    const layoutIndex = this.layout.index;
    if (layoutIndex === null) fail(`${this.path} is not chunked`);
    if (layoutIndex.type === "single") {
      index.set(this.shape.map(() => 0).join(","), {
        address: layoutIndex.address,
        size: layoutIndex.filteredSize ?? elementCount(this.layout.chunkDims) * this.type.size,
        filterMask: layoutIndex.filterMask,
      });
    } else {
      const buf = this.file.buf;
      const O = this.file.offsetSize;
      const rank = this.shape.length;
      const keySize = 8 + (rank + 1) * 8;
      const visit = (node: number): void => {
        if (!signatureAt(buf, node, "TREE")) fail(`${this.path}: no chunk B-tree node at ${String(node)}`);
        if (buf[node + 4] !== 1) fail(`${this.path}: B-tree node is not a chunk node`);
        const level = buf[node + 5] ?? 0;
        const entries = readUint(buf, node + 6, 2);
        let pos = node + 8 + 2 * O;
        for (let i = 0; i < entries; i += 1) {
          const size = readUint(buf, pos, 4);
          const filterMask = readUint(buf, pos + 4, 4);
          const offsets: number[] = [];
          for (let d = 0; d < rank; d += 1) offsets.push(readUint(buf, pos + 8 + d * 8, 8));
          const child = this.file.requireAddress(pos + keySize, `${this.path} chunk`);
          if (level === 0) index.set(offsets.join(","), { address: child, size, filterMask });
          else visit(child);
          pos += keySize + O;
        }
      };
      visit(layoutIndex.address);
    }
    this.chunkIndex = index;
    return index;
  }

  /** A chunk's decoded bytes, or null when the chunk was never written. */
  private chunk(origin: readonly number[]): Buffer | null {
    const key = origin.join(",");
    const cached = this.chunkCache.get(key);
    if (cached !== undefined) return cached;
    const entry = this.chunks().get(key);
    let bytes: Buffer | null = null;
    if (entry !== undefined) {
      bytes = this.file.buf.subarray(entry.address, entry.address + entry.size);
      for (let i = this.filters.length - 1; i >= 0; i -= 1) {
        if ((entry.filterMask & (1 << i)) !== 0) continue;
        const filter = this.filters[i];
        if (filter === undefined) continue;
        if (filter.id === FILTER_DEFLATE) bytes = inflateSync(bytes);
        else if (filter.id === FILTER_FLETCHER32) bytes = bytes.subarray(0, bytes.length - 4);
        else if (filter.id === FILTER_SHUFFLE) bytes = unshuffle(bytes, filter.clientData[0] ?? this.type.size);
      }
      const expected = elementCount(this.layout.chunkDims) * this.type.size;
      if (bytes.length !== expected) fail(`${this.path}: chunk decodes to ${String(bytes.length)} bytes, expected ${String(expected)}`);
    }
    this.chunkCache.set(key, bytes);
    return bytes;
  }

  /** The element at `index` (one coordinate per dimension), or null for an
   *  element in a chunk that was never written. */
  read(index: readonly number[]): number | null {
    if (index.length !== this.shape.length) fail(`${this.path}: index rank ${String(index.length)} does not match ${String(this.shape.length)}`);
    index.forEach((value, d) => {
      if (!Number.isInteger(value) || value < 0 || value >= (this.shape[d] ?? 0)) fail(`${this.path}: index ${String(value)} out of range on dimension ${String(d)}`);
    });
    if (this.layout.kind === "chunked") {
      const chunkDims = this.layout.chunkDims;
      const origin = index.map((value, d) => Math.floor(value / (chunkDims[d] ?? 1)) * (chunkDims[d] ?? 1));
      const bytes = this.chunk(origin);
      if (bytes === null) return null;
      let linear = 0;
      index.forEach((value, d) => {
        linear = linear * (chunkDims[d] ?? 1) + (value - (origin[d] ?? 0));
      });
      return decodeNumber(bytes, linear * this.type.size, this.type);
    }
    let linear = 0;
    index.forEach((value, d) => {
      linear = linear * (this.shape[d] ?? 1) + value;
    });
    if (this.layout.kind === "compact") {
      if (this.layout.compactData === null) fail(`${this.path}: compact layout without data`);
      return decodeNumber(this.layout.compactData, linear * this.type.size, this.type);
    }
    if (this.layout.address === null) return null;
    return decodeNumber(this.file.buf, this.layout.address + linear * this.type.size, this.type);
  }

  /** Every element of a one-dimensional dataset. */
  readVector(): (number | null)[] {
    if (this.shape.length !== 1) fail(`${this.path} is not one-dimensional`);
    const values: (number | null)[] = [];
    for (let i = 0; i < (this.shape[0] ?? 0); i += 1) values.push(this.read([i]));
    return values;
  }
}

function unshuffle(bytes: Buffer, elementSize: number): Buffer {
  if (elementSize <= 1) return bytes;
  const count = Math.floor(bytes.length / elementSize);
  const out = Buffer.alloc(bytes.length);
  for (let b = 0; b < elementSize; b += 1) {
    for (let i = 0; i < count; i += 1) out[i * elementSize + b] = bytes[b * count + i] ?? 0;
  }
  // Any tail bytes beyond whole elements are copied as they are.
  bytes.copy(out, count * elementSize, count * elementSize);
  return out;
}
