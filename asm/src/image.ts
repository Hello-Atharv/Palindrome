// .rvm image writer (spec/program_format.md). All integers little-endian.

import type { SymbolInfo } from './assemble.js';

const MAGIC = 0x314d5652; // "RVM1"
const VERSION = 1;

function symbolBlob(symbols: SymbolInfo[]): number[] {
  const out: number[] = [];
  for (const s of symbols) {
    const name = Array.from(s.name, (c) => c.charCodeAt(0) & 0x7f).slice(0, 255);
    out.push(s.addr & 255, (s.addr >>> 8) & 255, (s.addr >>> 16) & 255, (s.addr >>> 24) & 255);
    out.push(s.kind === 'code' ? 0 : 1, name.length, ...name);
  }
  return out;
}

export function buildImage(entry: number, code: number[], data: number[], symbols: SymbolInfo[]): Uint8Array {
  const sym = symbolBlob(symbols);
  const bytes = new Uint8Array(32 + 4 * (code.length + data.length) + sym.length);
  const view = new DataView(bytes.buffer);
  const header = [MAGIC, VERSION, entry, code.length, data.length, sym.length, 0, 0];
  header.forEach((w, k) => view.setUint32(4 * k, w >>> 0, true));
  let off = 32;
  for (const w of code) {
    view.setUint32(off, w >>> 0, true);
    off += 4;
  }
  for (const w of data) {
    view.setUint32(off, w >>> 0, true);
    off += 4;
  }
  bytes.set(sym, off);
  return bytes;
}
