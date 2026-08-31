using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace Venviewer.NativeCapture
{
    internal sealed class DeterministicPngVerification
    {
        private readonly int[] _chromaticities;
        private readonly string[] _chunkSequence;

        internal DeterministicPngVerification(
            int width,
            int height,
            int bitDepth,
            int renderingIntent,
            int gamma,
            int[] chromaticities,
            string[] chunkSequence,
            long idatByteLength,
            long inflatedByteLength,
            string pngSha256,
            SrgbTaggedDisplayFrame decodedFrame)
        {
            Width = width;
            Height = height;
            BitDepth = bitDepth;
            RenderingIntent = renderingIntent;
            Gamma = gamma;
            _chromaticities = (int[])chromaticities.Clone();
            _chunkSequence = (string[])chunkSequence.Clone();
            IdatByteLength = idatByteLength;
            InflatedByteLength = inflatedByteLength;
            PngSha256 = pngSha256;
            DecodedFrame = decodedFrame;
            AllChunkCrcsVerified = true;
            ZlibStoredBlocksVerified = true;
            Adler32Verified = true;
            FilterZeroVerified = true;
            NoTrailingBytesVerified = true;
        }

        internal int Width { get; private set; }
        internal int Height { get; private set; }
        internal int BitDepth { get; private set; }
        internal int RenderingIntent { get; private set; }
        internal int Gamma { get; private set; }
        internal long IdatByteLength { get; private set; }
        internal long InflatedByteLength { get; private set; }
        internal string PngSha256 { get; private set; }
        internal SrgbTaggedDisplayFrame DecodedFrame { get; private set; }
        internal bool AllChunkCrcsVerified { get; private set; }
        internal bool ZlibStoredBlocksVerified { get; private set; }
        internal bool Adler32Verified { get; private set; }
        internal bool FilterZeroVerified { get; private set; }
        internal bool NoTrailingBytesVerified { get; private set; }

        internal int[] CopyChromaticities()
        {
            return (int[])_chromaticities.Clone();
        }

        internal string[] CopyChunkSequence()
        {
            return (string[])_chunkSequence.Clone();
        }
    }

    internal static class DeterministicPng
    {
        internal const int SrgbRenderingIntent = 0;
        internal const int SrgbGamma = 45455;
        internal const string ChunkSequence = "IHDR,sRGB,gAMA,cHRM,IDAT,IEND";

        private const uint CrcPolynomial = 0xEDB88320U;
        private const uint AdlerModulus = 65521U;
        private const int MaximumStoredBlockLength = 65535;

        private static readonly byte[] Signature =
        {
            137, 80, 78, 71, 13, 10, 26, 10
        };

        private static readonly int[] SrgbChromaticities =
        {
            31270,
            32900,
            64000,
            33000,
            30000,
            60000,
            15000,
            6000
        };

        private static readonly uint[] EncoderCrcTable = CreateEncoderCrcTable();
        private static readonly uint[] VerifierCrcTable = CreateVerifierCrcTable();

        internal static byte[] Encode(SrgbTaggedDisplayFrame frame)
        {
            if (frame == null)
            {
                throw new ArgumentNullException("frame");
            }
            if (frame.BitDepth != 8 && frame.BitDepth != 16)
            {
                throw new ArgumentOutOfRangeException("frame", "Unsupported PNG sample depth.");
            }

            byte[] scanlines = CreateTopDownFilterZeroScanlines(frame);
            byte[] zlib = EncodeStoredZlib(scanlines);
            using (var stream = new MemoryStream())
            {
                stream.Write(Signature, 0, Signature.Length);
                WriteChunk(stream, "IHDR", CreateIhdr(frame));
                WriteChunk(stream, "sRGB", new[] { (byte)SrgbRenderingIntent });
                WriteChunk(stream, "gAMA", CreateUInt32Data((uint)SrgbGamma));
                WriteChunk(stream, "cHRM", CreateChromaticityData());
                WriteChunk(stream, "IDAT", zlib);
                WriteChunk(stream, "IEND", new byte[0]);
                return stream.ToArray();
            }
        }

        internal static DeterministicPngVerification VerifyAndDecode(
            byte[] pngBytes,
            RasterRowOrigin decodedRowOrigin)
        {
            DisplayEncodingPolicy.RequireRowOrigin(decodedRowOrigin);
            ParsedPng parsed = ParseLockedPng(pngBytes);
            int expectedInflatedLength = ComputeExpectedScanlineLength(
                parsed.Width,
                parsed.Height,
                parsed.BitDepth);
            byte[] inflated = DecodeStoredZlib(parsed.Idat, expectedInflatedLength);
            SrgbTaggedDisplayFrame decoded = DecodeFilterZeroScanlines(
                inflated,
                parsed.Width,
                parsed.Height,
                parsed.BitDepth,
                decodedRowOrigin);
            return new DeterministicPngVerification(
                parsed.Width,
                parsed.Height,
                parsed.BitDepth,
                SrgbRenderingIntent,
                SrgbGamma,
                parsed.Chromaticities,
                parsed.ChunkTypes,
                parsed.Idat.LongLength,
                inflated.LongLength,
                DisplayEncodingPolicy.Sha256Bytes(pngBytes),
                decoded);
        }

        internal static int[] CopySrgbChromaticities()
        {
            return (int[])SrgbChromaticities.Clone();
        }

        private static ParsedPng ParseLockedPng(byte[] pngBytes)
        {
            RequirePngEnvelope(pngBytes);
            int offset = Signature.Length;
            PngChunkView ihdr = ReadRequiredChunk(pngBytes, ref offset, "IHDR");
            PngChunkView srgb = ReadRequiredChunk(pngBytes, ref offset, "sRGB");
            PngChunkView gamma = ReadRequiredChunk(pngBytes, ref offset, "gAMA");
            PngChunkView chromaticity = ReadRequiredChunk(pngBytes, ref offset, "cHRM");
            PngChunkView idat = ReadRequiredChunk(pngBytes, ref offset, "IDAT");
            PngChunkView iend = ReadRequiredChunk(pngBytes, ref offset, "IEND");
            if (offset != pngBytes.Length)
            {
                throw new InvalidDataException("The PNG contains trailing bytes or extra chunks.");
            }

            int width;
            int height;
            int bitDepth;
            ParseIhdr(
                pngBytes,
                ihdr.DataOffset,
                ihdr.DataLength,
                out width,
                out height,
                out bitDepth);
            RequireSrgbIntent(pngBytes, srgb);
            RequireGamma(pngBytes, gamma);
            int[] chromaticities = ParseChromaticities(
                pngBytes,
                chromaticity.DataOffset,
                chromaticity.DataLength);
            byte[] idatBytes = CopyNonEmptyChunkData(pngBytes, idat, "IDAT");
            if (iend.DataLength != 0)
            {
                throw new InvalidDataException("The IEND chunk must be empty.");
            }
            return new ParsedPng(
                width,
                height,
                bitDepth,
                chromaticities,
                ChunkSequence.Split(','),
                idatBytes);
        }

        private static void RequirePngEnvelope(byte[] pngBytes)
        {
            if (pngBytes == null)
            {
                throw new ArgumentNullException("pngBytes");
            }
            if (pngBytes.Length < Signature.Length + (12 * 6))
            {
                throw new InvalidDataException("The PNG payload is too short.");
            }
            for (int index = 0; index < Signature.Length; index += 1)
            {
                if (pngBytes[index] != Signature[index])
                {
                    throw new InvalidDataException("The PNG signature is invalid.");
                }
            }
        }

        private static PngChunkView ReadRequiredChunk(
            byte[] pngBytes,
            ref int offset,
            string expectedType)
        {
            if (offset > pngBytes.Length - 12)
            {
                throw new InvalidDataException("The PNG ended before its required chunks were complete.");
            }
            uint unsignedLength = ReadUInt32BigEndian(pngBytes, offset);
            if (unsignedLength > Int32.MaxValue)
            {
                throw new InvalidDataException("A PNG chunk exceeds the supported deterministic length.");
            }
            int dataLength = (int)unsignedLength;
            string actualType = Encoding.ASCII.GetString(pngBytes, offset + 4, 4);
            if (!String.Equals(actualType, expectedType, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    "Expected PNG chunk " + expectedType + " but found " + actualType + ".");
            }
            long chunkEnd = checked((long)offset + 12L + dataLength);
            if (chunkEnd > pngBytes.LongLength)
            {
                throw new InvalidDataException("A PNG chunk extends beyond the payload.");
            }
            int dataOffset = offset + 8;
            uint storedCrc = ReadUInt32BigEndian(pngBytes, checked(dataOffset + dataLength));
            uint computedCrc = ComputeVerifierCrc(
                pngBytes,
                offset + 4,
                checked(4 + dataLength));
            if (storedCrc != computedCrc)
            {
                throw new InvalidDataException("The " + actualType + " chunk CRC is invalid.");
            }
            offset = (int)chunkEnd;
            return new PngChunkView(dataOffset, dataLength);
        }

        private static void RequireSrgbIntent(byte[] pngBytes, PngChunkView chunk)
        {
            if (chunk.DataLength != 1 || pngBytes[chunk.DataOffset] != SrgbRenderingIntent)
            {
                throw new InvalidDataException("The sRGB rendering intent is not the locked perceptual value.");
            }
        }

        private static void RequireGamma(byte[] pngBytes, PngChunkView chunk)
        {
            if (chunk.DataLength != 4 ||
                ReadUInt32BigEndian(pngBytes, chunk.DataOffset) != SrgbGamma)
            {
                throw new InvalidDataException("The gAMA chunk is not the canonical sRGB value.");
            }
        }

        private static byte[] CopyNonEmptyChunkData(
            byte[] pngBytes,
            PngChunkView chunk,
            string label)
        {
            if (chunk.DataLength == 0)
            {
                throw new InvalidDataException("The deterministic " + label + " chunk is empty.");
            }
            var result = new byte[chunk.DataLength];
            Buffer.BlockCopy(pngBytes, chunk.DataOffset, result, 0, result.Length);
            return result;
        }

        private static byte[] CreateTopDownFilterZeroScanlines(SrgbTaggedDisplayFrame frame)
        {
            byte[] samples = frame.CopySampleBytes();
            int rowBytes;
            int outputLength;
            try
            {
                rowBytes = checked(frame.Width * frame.BytesPerPixel);
                outputLength = checked(frame.Height * checked(rowBytes + 1));
            }
            catch (OverflowException)
            {
                throw new ArgumentOutOfRangeException(
                    "frame",
                    "The PNG scanline allocation exceeds the supported deterministic size.");
            }

            var scanlines = new byte[outputLength];
            for (int pngRow = 0; pngRow < frame.Height; pngRow += 1)
            {
                int sourceRow = frame.RowOrigin == RasterRowOrigin.UpperLeft
                    ? pngRow
                    : frame.Height - 1 - pngRow;
                int destinationOffset = checked(pngRow * checked(rowBytes + 1));
                scanlines[destinationOffset] = 0;
                Buffer.BlockCopy(
                    samples,
                    checked(sourceRow * rowBytes),
                    scanlines,
                    destinationOffset + 1,
                    rowBytes);
            }
            return scanlines;
        }

        private static byte[] CreateIhdr(SrgbTaggedDisplayFrame frame)
        {
            var data = new byte[13];
            WriteUInt32BigEndian(data, 0, (uint)frame.Width);
            WriteUInt32BigEndian(data, 4, (uint)frame.Height);
            data[8] = (byte)frame.BitDepth;
            data[9] = 2;
            data[10] = 0;
            data[11] = 0;
            data[12] = 0;
            return data;
        }

        private static byte[] CreateUInt32Data(uint value)
        {
            var data = new byte[4];
            WriteUInt32BigEndian(data, 0, value);
            return data;
        }

        private static byte[] CreateChromaticityData()
        {
            var data = new byte[SrgbChromaticities.Length * 4];
            for (int index = 0; index < SrgbChromaticities.Length; index += 1)
            {
                WriteUInt32BigEndian(data, index * 4, (uint)SrgbChromaticities[index]);
            }
            return data;
        }

        private static void WriteChunk(MemoryStream stream, string type, byte[] data)
        {
            byte[] typeBytes = Encoding.ASCII.GetBytes(type);
            if (typeBytes.Length != 4)
            {
                throw new InvalidOperationException("PNG chunk names must contain four ASCII bytes.");
            }

            WriteUInt32BigEndian(stream, (uint)data.Length);
            stream.Write(typeBytes, 0, typeBytes.Length);
            stream.Write(data, 0, data.Length);
            uint crc = ComputeEncoderCrc(typeBytes, data);
            WriteUInt32BigEndian(stream, crc);
        }

        private static byte[] EncodeStoredZlib(byte[] input)
        {
            if (input == null || input.Length == 0)
            {
                throw new ArgumentException("The PNG scanline stream must not be empty.", "input");
            }

            using (var stream = new MemoryStream())
            {
                stream.WriteByte(0x78);
                stream.WriteByte(0x01);
                int offset = 0;
                while (offset < input.Length)
                {
                    int length = Math.Min(MaximumStoredBlockLength, input.Length - offset);
                    bool final = offset + length == input.Length;
                    stream.WriteByte(final ? (byte)1 : (byte)0);
                    WriteUInt16LittleEndian(stream, (ushort)length);
                    WriteUInt16LittleEndian(stream, (ushort)(length ^ 0xFFFF));
                    stream.Write(input, offset, length);
                    offset += length;
                }
                WriteUInt32BigEndian(stream, ComputeEncoderAdler32(input));
                return stream.ToArray();
            }
        }

        private static byte[] DecodeStoredZlib(byte[] zlib, int expectedInflatedLength)
        {
            if (zlib == null || zlib.Length < 12)
            {
                throw new InvalidDataException("The deterministic zlib stream is too short.");
            }
            if (zlib[0] != 0x78 || zlib[1] != 0x01)
            {
                throw new InvalidDataException("The deterministic zlib header is not 0x7801.");
            }

            int payloadEnd = zlib.Length - 4;
            int offset = 2;
            int decodedLength = 0;
            bool finalObserved = false;
            using (var output = new MemoryStream())
            {
                while (!finalObserved)
                {
                    if (offset > payloadEnd - 5)
                    {
                        throw new InvalidDataException("A stored DEFLATE block header is truncated.");
                    }
                    byte blockHeader = zlib[offset];
                    offset += 1;
                    if (blockHeader != 0 && blockHeader != 1)
                    {
                        throw new InvalidDataException("The DEFLATE stream is not composed solely of byte-aligned stored blocks.");
                    }
                    finalObserved = blockHeader == 1;
                    int length = ReadUInt16LittleEndian(zlib, offset);
                    int complement = ReadUInt16LittleEndian(zlib, offset + 2);
                    offset += 4;
                    if (((length ^ 0xFFFF) & 0xFFFF) != complement)
                    {
                        throw new InvalidDataException("A stored DEFLATE block LEN/NLEN pair is invalid.");
                    }
                    if (offset > payloadEnd - length)
                    {
                        throw new InvalidDataException("A stored DEFLATE block extends beyond the zlib payload.");
                    }
                    int expectedBlockLength = Math.Min(
                        MaximumStoredBlockLength,
                        expectedInflatedLength - decodedLength);
                    bool expectedFinal = decodedLength + expectedBlockLength ==
                        expectedInflatedLength;
                    if (expectedBlockLength <= 0 || length != expectedBlockLength ||
                        finalObserved != expectedFinal)
                    {
                        throw new InvalidDataException(
                            "The stored DEFLATE block partition is not the locked deterministic partition.");
                    }
                    output.Write(zlib, offset, length);
                    offset += length;
                    decodedLength += length;
                }

                if (offset != payloadEnd)
                {
                    throw new InvalidDataException("The zlib stream contains bytes after its final stored block.");
                }
                byte[] inflated = output.ToArray();
                uint storedAdler = ReadUInt32BigEndian(zlib, payloadEnd);
                uint computedAdler = ComputeVerifierAdler32(inflated);
                if (storedAdler != computedAdler)
                {
                    throw new InvalidDataException("The zlib Adler-32 checksum is invalid.");
                }
                return inflated;
            }
        }

        private static int ComputeExpectedScanlineLength(int width, int height, int bitDepth)
        {
            try
            {
                int bytesPerPixel = bitDepth == 8 ? 3 : 6;
                int rowBytes = checked(width * bytesPerPixel);
                return checked(height * checked(rowBytes + 1));
            }
            catch (OverflowException exception)
            {
                throw new InvalidDataException(
                    "The PNG dimensions overflow the supported deterministic scanline size.",
                    exception);
            }
        }

        private static SrgbTaggedDisplayFrame DecodeFilterZeroScanlines(
            byte[] scanlines,
            int width,
            int height,
            int bitDepth,
            RasterRowOrigin outputRowOrigin)
        {
            int bytesPerPixel = bitDepth == 8 ? 3 : 6;
            int rowBytes;
            int expectedScanlineLength;
            int sampleLength;
            try
            {
                rowBytes = checked(width * bytesPerPixel);
                expectedScanlineLength = checked(height * checked(rowBytes + 1));
                sampleLength = checked(width * height * bytesPerPixel);
            }
            catch (OverflowException exception)
            {
                throw new InvalidDataException("The decoded PNG dimensions overflow the supported raster size.", exception);
            }
            if (scanlines.Length != expectedScanlineLength)
            {
                throw new InvalidDataException(
                    "The inflated scanline stream has " +
                    scanlines.Length.ToString(CultureInfo.InvariantCulture) +
                    " bytes; expected " +
                    expectedScanlineLength.ToString(CultureInfo.InvariantCulture) + ".");
            }

            var samples = new byte[sampleLength];
            for (int pngRow = 0; pngRow < height; pngRow += 1)
            {
                int sourceOffset = checked(pngRow * checked(rowBytes + 1));
                if (scanlines[sourceOffset] != 0)
                {
                    throw new InvalidDataException("A PNG scanline does not use the locked filter type 0.");
                }
                int outputRow = outputRowOrigin == RasterRowOrigin.UpperLeft
                    ? pngRow
                    : height - 1 - pngRow;
                Buffer.BlockCopy(
                    scanlines,
                    sourceOffset + 1,
                    samples,
                    checked(outputRow * rowBytes),
                    rowBytes);
            }
            return new SrgbTaggedDisplayFrame(width, height, bitDepth, outputRowOrigin, samples);
        }

        private static void ParseIhdr(
            byte[] png,
            int offset,
            int length,
            out int width,
            out int height,
            out int bitDepth)
        {
            if (length != 13)
            {
                throw new InvalidDataException("The IHDR chunk length is invalid.");
            }
            uint unsignedWidth = ReadUInt32BigEndian(png, offset);
            uint unsignedHeight = ReadUInt32BigEndian(png, offset + 4);
            if (unsignedWidth == 0 || unsignedHeight == 0 ||
                unsignedWidth > Int32.MaxValue || unsignedHeight > Int32.MaxValue)
            {
                throw new InvalidDataException("The PNG dimensions are outside the supported range.");
            }
            width = (int)unsignedWidth;
            height = (int)unsignedHeight;
            bitDepth = png[offset + 8];
            if ((bitDepth != 8 && bitDepth != 16) ||
                png[offset + 9] != 2 ||
                png[offset + 10] != 0 ||
                png[offset + 11] != 0 ||
                png[offset + 12] != 0)
            {
                throw new InvalidDataException("The IHDR is not non-interlaced 8-bit or 16-bit truecolour RGB.");
            }
        }

        private static int[] ParseChromaticities(byte[] png, int offset, int length)
        {
            if (length != SrgbChromaticities.Length * 4)
            {
                throw new InvalidDataException("The cHRM chunk length is invalid.");
            }

            var values = new int[SrgbChromaticities.Length];
            for (int index = 0; index < values.Length; index += 1)
            {
                uint value = ReadUInt32BigEndian(png, offset + (index * 4));
                if (value != SrgbChromaticities[index])
                {
                    throw new InvalidDataException("The cHRM chunk is not the canonical sRGB value set.");
                }
                values[index] = (int)value;
            }
            return values;
        }

        private static uint ComputeEncoderCrc(byte[] type, byte[] data)
        {
            uint crc = 0xFFFFFFFFU;
            for (int index = 0; index < type.Length; index += 1)
            {
                crc = UpdateEncoderCrc(crc, type[index]);
            }
            for (int index = 0; index < data.Length; index += 1)
            {
                crc = UpdateEncoderCrc(crc, data[index]);
            }
            return crc ^ 0xFFFFFFFFU;
        }

        private static uint UpdateEncoderCrc(uint crc, byte value)
        {
            return EncoderCrcTable[(crc ^ value) & 255U] ^ (crc >> 8);
        }

        private static uint ComputeVerifierCrc(byte[] bytes, int offset, int count)
        {
            uint accumulator = 0xFFFFFFFFU;
            int end = checked(offset + count);
            for (int index = offset; index < end; index += 1)
            {
                accumulator = VerifierCrcTable[(accumulator ^ bytes[index]) & 255U] ^
                    (accumulator >> 8);
            }
            return ~accumulator;
        }

        private static uint[] CreateEncoderCrcTable()
        {
            var table = new uint[256];
            for (uint index = 0; index < table.Length; index += 1)
            {
                uint value = index;
                for (int bit = 0; bit < 8; bit += 1)
                {
                    value = (value & 1U) != 0
                        ? CrcPolynomial ^ (value >> 1)
                        : value >> 1;
                }
                table[index] = value;
            }
            return table;
        }

        private static uint[] CreateVerifierCrcTable()
        {
            var table = new uint[256];
            for (int index = 0; index < table.Length; index += 1)
            {
                uint value = (uint)index;
                int remainingBits = 8;
                while (remainingBits > 0)
                {
                    uint lowBitMask = (value & 1U) == 0 ? 0U : UInt32.MaxValue;
                    value = (value >> 1) ^ (CrcPolynomial & lowBitMask);
                    remainingBits -= 1;
                }
                table[index] = value;
            }
            return table;
        }

        private static uint ComputeEncoderAdler32(byte[] bytes)
        {
            uint first = 1U;
            uint second = 0U;
            for (int index = 0; index < bytes.Length; index += 1)
            {
                first = (first + bytes[index]) % AdlerModulus;
                second = (second + first) % AdlerModulus;
            }
            return (second << 16) | first;
        }

        private static uint ComputeVerifierAdler32(byte[] bytes)
        {
            const int maximumChunk = 5552;
            uint first = 1U;
            uint second = 0U;
            int offset = 0;
            while (offset < bytes.Length)
            {
                int count = Math.Min(maximumChunk, bytes.Length - offset);
                int end = offset + count;
                for (int index = offset; index < end; index += 1)
                {
                    first += bytes[index];
                    second += first;
                }
                first %= AdlerModulus;
                second %= AdlerModulus;
                offset = end;
            }
            return (second << 16) | first;
        }

        private static void WriteUInt16LittleEndian(Stream stream, ushort value)
        {
            stream.WriteByte((byte)(value & 255));
            stream.WriteByte((byte)(value >> 8));
        }

        private static int ReadUInt16LittleEndian(byte[] bytes, int offset)
        {
            return bytes[offset] | (bytes[offset + 1] << 8);
        }

        private static void WriteUInt32BigEndian(Stream stream, uint value)
        {
            stream.WriteByte((byte)((value >> 24) & 255U));
            stream.WriteByte((byte)((value >> 16) & 255U));
            stream.WriteByte((byte)((value >> 8) & 255U));
            stream.WriteByte((byte)(value & 255U));
        }

        private static void WriteUInt32BigEndian(byte[] bytes, int offset, uint value)
        {
            bytes[offset] = (byte)((value >> 24) & 255U);
            bytes[offset + 1] = (byte)((value >> 16) & 255U);
            bytes[offset + 2] = (byte)((value >> 8) & 255U);
            bytes[offset + 3] = (byte)(value & 255U);
        }

        private static uint ReadUInt32BigEndian(byte[] bytes, int offset)
        {
            return ((uint)bytes[offset] << 24) |
                ((uint)bytes[offset + 1] << 16) |
                ((uint)bytes[offset + 2] << 8) |
                bytes[offset + 3];
        }

        private sealed class ParsedPng
        {
            internal ParsedPng(
                int width,
                int height,
                int bitDepth,
                int[] chromaticities,
                string[] chunkTypes,
                byte[] idat)
            {
                Width = width;
                Height = height;
                BitDepth = bitDepth;
                Chromaticities = chromaticities;
                ChunkTypes = chunkTypes;
                Idat = idat;
            }

            internal int Width;
            internal int Height;
            internal int BitDepth;
            internal int[] Chromaticities;
            internal string[] ChunkTypes;
            internal byte[] Idat;
        }

        private struct PngChunkView
        {
            internal PngChunkView(int dataOffset, int dataLength)
            {
                DataOffset = dataOffset;
                DataLength = dataLength;
            }

            internal int DataOffset;
            internal int DataLength;
        }
    }
}
