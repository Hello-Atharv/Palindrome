/** .rvm image reader/writer (spec/program_format.md). All integers little-endian u32. */
import { decode, OP_MAX, type Instr } from './isa';

export const MAGIC = 0x314d5652; // bytes 'R','V','M','1'
export const VERSION = 1;
export const HEADER_WORDS = 8;
const MAX_WORDS = 65536;

export interface Symbol {
  addr: number;
  /** 0 = code label, 1 = data label */
  kind: number;
  name: string;
}

export interface Program {
  entry: number;
  code: Uint32Array;
  decoded: Instr[];
  data: Uint32Array;
  symbols: Symbol[];
}

export type ParseResult = { ok: true; program: Program } | { ok: false; error: string };

const bad = (error: string): ParseResult => ({ ok: false, error });

export function parseImage(image: Uint8Array): ParseResult {
  if (image.byteLength < HEADER_WORDS * 4) return bad('image shorter than header');
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const w = (i: number): number => dv.getUint32(i * 4, true);
  if (w(0) !== MAGIC) return bad('bad magic');
  if (w(1) !== VERSION) return bad(`unsupported version ${w(1)}`);
  const entry = w(2), codeLen = w(3), dataLen = w(4), symLen = w(5);
  if (codeLen > MAX_WORDS) return bad('code_len > 65536');
  if (dataLen > MAX_WORDS) return bad('data_len > 65536');
  if (entry >= codeLen) return bad('entry outside code');
  const codeOff = HEADER_WORDS * 4;
  const dataOff = codeOff + codeLen * 4;
  const symOff = dataOff + dataLen * 4;
  if (symOff + symLen > image.byteLength) return bad('sizes exceed file');

  const code = new Uint32Array(codeLen);
  for (let i = 0; i < codeLen; i++) {
    code[i] = dv.getUint32(codeOff + i * 4, true);
    if (code[i] >>> 26 > OP_MAX) return bad(`undefined opcode at code[${i}]`);
  }
  const data = new Uint32Array(dataLen);
  for (let i = 0; i < dataLen; i++) data[i] = dv.getUint32(dataOff + i * 4, true);

  const symbols: Symbol[] = [];
  const dec = new TextDecoder();
  for (let p = symOff, end = symOff + symLen; p < end;) {
    if (p + 6 > end) return bad('truncated symbol table');
    const nameLen = dv.getUint8(p + 5);
    if (p + 6 + nameLen > end) return bad('truncated symbol name');
    const name = dec.decode(image.subarray(p + 6, p + 6 + nameLen));
    symbols.push({ addr: dv.getUint32(p, true), kind: dv.getUint8(p + 4), name });
    p += 6 + nameLen;
  }
  return { ok: true, program: { entry, code, decoded: Array.from(code, decode), data, symbols } };
}

export interface ImageParts {
  entry?: number;
  code: ArrayLike<number>;
  data?: ArrayLike<number>;
  symbols?: Symbol[];
}

export function buildImage(p: ImageParts): Uint8Array {
  const enc = new TextEncoder();
  const syms = (p.symbols ?? []).map((s) => ({ ...s, bytes: enc.encode(s.name) }));
  const symLen = syms.reduce((n, s) => n + 6 + s.bytes.length, 0);
  const data = p.data ?? [];
  const out = new Uint8Array((HEADER_WORDS + p.code.length + data.length) * 4 + symLen);
  const dv = new DataView(out.buffer);
  [MAGIC, VERSION, p.entry ?? 0, p.code.length, data.length, symLen, 0, 0].forEach((v, i) => dv.setUint32(i * 4, v, true));
  let o = HEADER_WORDS * 4;
  for (let i = 0; i < p.code.length; i++, o += 4) dv.setUint32(o, p.code[i], true);
  for (let i = 0; i < data.length; i++, o += 4) dv.setUint32(o, data[i] >>> 0, true);
  for (const s of syms) {
    dv.setUint32(o, s.addr, true);
    dv.setUint8(o + 4, s.kind);
    dv.setUint8(o + 5, s.bytes.length);
    out.set(s.bytes, o + 6);
    o += 6 + s.bytes.length;
  }
  return out;
}
