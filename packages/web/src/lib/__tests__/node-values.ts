// ---------------------------------------------------------------------------
// A shader node graph's value on plain numbers, for tests.
//
// A TSL graph cannot be run without a GPU, so a test of shader arithmetic
// usually tests a plain-number copy of it and trusts the two to agree. This
// walks the graph itself: constants, uniforms (at their current values), the
// arithmetic operators, the handful of maths methods the film toe and the
// grade use, vector construction and component picks, selects, and the screen
// position, which the caller supplies. It is deliberately small. A node it
// does not know throws, so a graph that grows past it fails its test and this
// is taught the new node rather than guessing.
// ---------------------------------------------------------------------------

import { ConditionalNode, ConstNode, ConvertNode, JoinNode, MathNode, OperatorNode, ScreenNode, SplitNode, UniformNode, VarNode, type Node } from "three/webgpu";

/** A node's value: a number, or a vector's components. */
export type NodeValue = number | number[];

/** What a fragment's surroundings hand a node that asks for them. */
export interface Fragment {
  /** Where the fragment is on the screen, 0 to 1 each way. */
  readonly screenUV: readonly [number, number];
}

const COMPONENT: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
const SIZE: Readonly<Record<string, number>> = { float: 1, vec2: 2, vec3: 3, vec4: 4, color: 3 };

const sizeOf = (value: NodeValue): number => (typeof value === "number" ? 1 : value.length);

function component(value: NodeValue, index: number): number {
  if (typeof value === "number") return value;
  const got = value[index];
  if (got === undefined) throw new Error(`a vector of ${String(value.length)} has no component ${String(index)}`);
  return got;
}

/** `op` on each component of two values, a number standing for every component. */
function each(a: NodeValue, b: NodeValue, op: (x: number, y: number) => number): NodeValue {
  if (typeof a === "number" && typeof b === "number") return op(a, b);
  const size = Math.max(sizeOf(a), sizeOf(b));
  if ((typeof a !== "number" && a.length !== size) || (typeof b !== "number" && b.length !== size)) {
    throw new Error(`vectors of ${String(sizeOf(a))} and ${String(sizeOf(b))} do not combine`);
  }
  return Array.from({ length: size }, (_, index) => op(component(a, index), component(b, index)));
}

/** A constant's or a uniform's value as plain numbers. */
function plain(value: unknown): NodeValue {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null) {
    if ("r" in value && "g" in value && "b" in value) return [Number(value.r), Number(value.g), Number(value.b)];
    if ("x" in value && "y" in value) {
      const vector = [Number(value.x), Number(value.y)];
      if ("z" in value) vector.push(Number(value.z));
      if ("w" in value) vector.push(Number(value.w));
      return vector;
    }
  }
  throw new Error(`no plain value for a ${typeof value}`);
}

function need(value: NodeValue | null, what: string): NodeValue {
  if (value === null) throw new Error(`${what} is missing an input`);
  return value;
}

function maths(node: MathNode, fragment: Fragment): NodeValue {
  const a = nodeValue(node.aNode, fragment);
  const b = node.bNode === null ? null : nodeValue(node.bNode, fragment);
  const c = node.cNode === null ? null : nodeValue(node.cNode, fragment);
  switch (node.method) {
    case MathNode.SQRT: return each(a, 0, (x) => Math.sqrt(x));
    case MathNode.LENGTH: return typeof a === "number" ? Math.abs(a) : Math.hypot(...a);
    case MathNode.MIN: return each(a, need(b, "min"), (x, y) => Math.min(x, y));
    case MathNode.MAX: return each(a, need(b, "max"), (x, y) => Math.max(x, y));
    case MathNode.DOT: {
      const products = each(a, need(b, "dot"), (x, y) => x * y);
      return typeof products === "number" ? products : products.reduce((sum, product) => sum + product, 0);
    }
    case MathNode.MIX: {
      // mix(a, b, t) = a + (b - a) t, as GLSL and WGSL define it.
      const span = each(need(b, "mix"), a, (y, x) => y - x);
      return each(a, each(span, need(c, "mix"), (x, t) => x * t), (x, step) => x + step);
    }
    case MathNode.SMOOTHSTEP: {
      // smoothstep(low, high, x): three keeps them in that order (aNode, bNode, cNode).
      const t = each(each(need(c, "smoothstep"), a, (x, low) => x - low), each(need(b, "smoothstep"), a, (high, low) => high - low), (num, den) => Math.min(1, Math.max(0, num / den)));
      return each(t, 0, (x) => x * x * (3 - 2 * x));
    }
    default: throw new Error(`the evaluator knows no maths method "${node.method}"`);
  }
}

function operator(node: OperatorNode, fragment: Fragment): NodeValue {
  const a = nodeValue(node.aNode, fragment);
  const b = nodeValue(node.bNode, fragment);
  switch (node.op) {
    case "+": return each(a, b, (x, y) => x + y);
    case "-": return each(a, b, (x, y) => x - y);
    case "*": return each(a, b, (x, y) => x * y);
    case "/": return each(a, b, (x, y) => x / y);
    case "<": return each(a, b, (x, y) => (x < y ? 1 : 0));
    default: throw new Error(`the evaluator knows no operator "${node.op}"`);
  }
}

/** The value `node` would have at `fragment`, its uniforms read as they stand now. */
export function nodeValue(node: Node, fragment: Fragment): NodeValue {
  // three may keep a function's result in a variable: the variable is its value.
  if (node instanceof VarNode) return nodeValue(node.node, fragment);
  if (node instanceof ConstNode || node instanceof UniformNode) return plain(node.value);
  if (node instanceof ScreenNode) {
    if (node.scope !== ScreenNode.UV) throw new Error(`the evaluator knows the screen's uv, not its ${node.scope}`);
    return [fragment.screenUV[0], fragment.screenUV[1]];
  }
  if (node instanceof ConvertNode) {
    const value = nodeValue(node.node, fragment);
    const size = SIZE[node.convertTo];
    if (size === undefined) throw new Error(`the evaluator knows no type "${node.convertTo}"`);
    if (typeof value === "number") return size === 1 ? value : Array.from({ length: size }, () => value);
    if (value.length !== size) throw new Error(`${String(value.length)} components do not convert to ${node.convertTo}`);
    return value;
  }
  if (node instanceof JoinNode) {
    return node.nodes.flatMap((part) => {
      const value = nodeValue(part, fragment);
      return typeof value === "number" ? [value] : value;
    });
  }
  if (node instanceof SplitNode) {
    const value = nodeValue(node.node, fragment);
    const picked: number[] = [];
    for (let at = 0; at < node.components.length; at += 1) {
      const letter = node.components.charAt(at);
      const index = COMPONENT[letter];
      if (index === undefined) throw new Error(`no component named "${letter}"`);
      picked.push(component(value, index));
    }
    const [only] = picked;
    return picked.length === 1 && only !== undefined ? only : picked;
  }
  if (node instanceof ConditionalNode) {
    const condition = nodeValue(node.condNode, fragment);
    if (typeof condition !== "number") throw new Error("the evaluator selects on one condition, not a vector of them");
    if (condition !== 0) return nodeValue(node.ifNode, fragment);
    if (node.elseNode === null) throw new Error("a select without its other branch has no value when its condition fails");
    return nodeValue(node.elseNode, fragment);
  }
  if (node instanceof OperatorNode) return operator(node, fragment);
  if (node instanceof MathNode) return maths(node, fragment);
  throw new Error(`the evaluator knows no ${node.type}`);
}
