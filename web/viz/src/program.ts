/** What the UI needs to know about a .rvm image beyond what RVM exposes: code length, entry, code labels. */

export interface ProgramInfo {
  name: string;
  image: Uint8Array;
  codeLen: number;
  entry: number;
  /** code address -> label */
  labels: Map<number, string>;
}

export interface ProgramEntry {
  name: string;
  blurb?: string;
  /** Produces the .rvm image (spec/program_format.md). */
  load: () => Uint8Array;
}

/** Lenient: the VM does the real validation in loadProgram. Falls back to empty info for a bad image. */
export function inspectImage(name: string, image: Uint8Array): ProgramInfo {
  const info: ProgramInfo = { name, image, codeLen: 0, entry: 0, labels: new Map() };
  if (image.byteLength < 32) return info;
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const entry = dv.getUint32(8, true), codeLen = dv.getUint32(12, true);
  const dataLen = dv.getUint32(16, true), symLen = dv.getUint32(20, true);
  info.entry = entry;
  info.codeLen = codeLen;
  const dec = new TextDecoder();
  let p = 32 + (codeLen + dataLen) * 4;
  const end = Math.min(image.byteLength, p + symLen);
  while (p + 6 <= end) {
    const nameLen = dv.getUint8(p + 5);
    if (p + 6 + nameLen > end) break;
    if (dv.getUint8(p + 4) === 0) {
      const addr = dv.getUint32(p, true);
      // several labels can share an address; show the first
      if (!info.labels.has(addr)) info.labels.set(addr, dec.decode(image.subarray(p + 6, p + 6 + nameLen)));
    }
    p += 6 + nameLen;
  }
  return info;
}
