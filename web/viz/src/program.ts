/** What the UI needs to know about a .rvm image beyond what RVM exposes: code length, entry, labels, garbage. */

export interface DataLabel {
  name: string;
  addr: number;
}

export interface ProgramInfo {
  name: string;
  image: Uint8Array;
  codeLen: number;
  dataLen: number;
  entry: number;
  /** code address -> label */
  labels: Map<number, string>;
  /** data labels in address order (for "jump to" in the memory view) */
  dataLabels: DataLabel[];
  /**
   * Data ranges [from, to) the program keeps only because it cannot erase them (SPEC section 9: "Sort garbage").
   * Found by convention: a data label whose name starts with `garbage` runs to the next data label (or the end of data).
   */
  garbage: [number, number][];
  /** Source text per code address, when the program came from the assembler (for the Learn view). */
  listing?: { addr: number; line: number; text: string }[];
  /** Assembly source, when the program came from the assembler. */
  source?: string;
  game?: GameInfo;
  /** 'rev' when `source` is rev, which is compiled rather than assembled. */
  language?: 'asm' | 'rev';
}

/** A program that is a game: it counts frames in the FRAME word (SPEC 11.7) and reads keys. */
export interface GameInfo {
  /** What to do and what to look at (plain text). */
  note: string;
  /** The score is a yellow block lit for each hit (pong.s); otherwise the program draws its own score. */
  blocks?: boolean;
  /** Data address of the input log, the only garbage the program keeps, and how many bytes it adds per frame. */
  log?: { addr: number; bytesPerFrame: number };
}

export interface ProgramEntry {
  name: string;
  blurb?: string;
  /** Produces the .rvm image (spec/program_format.md). May throw (the message is shown to the user). */
  load: () => Uint8Array;
  /** Source text, if the image is assembled from it: shown and editable in the Code view. */
  source?: string;
  /** The language of `source`: assembly (default) or rev (lang/). A rev program is compiled, not assembled. */
  language?: 'asm' | 'rev';
  /** The same program in the other language (assembly <-> rev). Each entry points at the other; only one is in the picker. */
  alt?: ProgramEntry;
  /** Set for games: frame stepping, the frame number on the time bar, and a note with the score. */
  game?: GameInfo;
}

/** Lenient: the VM does the real validation in loadProgram. Falls back to empty info for a bad image. */
export function inspectImage(name: string, image: Uint8Array, source?: string): ProgramInfo {
  const info: ProgramInfo = { name, image, codeLen: 0, dataLen: 0, entry: 0, labels: new Map(), dataLabels: [], garbage: [], source };
  if (image.byteLength < 32) return info;
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const entry = dv.getUint32(8, true), codeLen = dv.getUint32(12, true);
  const dataLen = dv.getUint32(16, true), symLen = dv.getUint32(20, true);
  info.entry = entry;
  info.codeLen = codeLen;
  info.dataLen = dataLen;
  const dec = new TextDecoder();
  let p = 32 + (codeLen + dataLen) * 4;
  const end = Math.min(image.byteLength, p + symLen);
  while (p + 6 <= end) {
    const nameLen = dv.getUint8(p + 5);
    if (p + 6 + nameLen > end) break;
    const addr = dv.getUint32(p, true);
    const label = dec.decode(image.subarray(p + 6, p + 6 + nameLen));
    if (dv.getUint8(p + 4) === 0) {
      // several labels can share an address; show the first
      if (!info.labels.has(addr)) info.labels.set(addr, label);
    } else {
      info.dataLabels.push({ name: label, addr });
    }
    p += 6 + nameLen;
  }
  info.dataLabels.sort((a, b) => a.addr - b.addr);
  info.dataLabels.forEach((l, i) => {
    if (!l.name.toLowerCase().startsWith('garbage')) return;
    const next = info.dataLabels.slice(i + 1).find((n) => n.addr > l.addr);
    info.garbage.push([l.addr, next ? next.addr : dataLen]);
  });
  return info;
}

export function inGarbage(info: ProgramInfo | null, addr: number): boolean {
  return info !== null && info.garbage.some(([a, b]) => addr >= a && addr < b);
}

/** Programs up to this size get the animated datapath; bigger ones (sort, cipher, Pong) do not. 64 fits add-two-numbers with its printing. */
export const LEARN_MAX_CODE = 64;
export const LEARN_MAX_DATA = 32;

/** Can the Learn view animate this program? `why` explains a refusal. */
export function learnVerdict(info: ProgramInfo | null): { ok: boolean; why: string } {
  if (!info || info.codeLen === 0) return { ok: false, why: 'Load a program first.' };
  if (info.codeLen > LEARN_MAX_CODE || info.dataLen > LEARN_MAX_DATA) {
    return {
      ok: false,
      why: `This program is too large to animate (${info.codeLen} instructions, ${info.dataLen} data words; the limit is ${LEARN_MAX_CODE} and ${LEARN_MAX_DATA}). The datapath animation is for simple examples. Step through this one in the editor and watch the Output tab.`,
    };
  }
  return { ok: true, why: '' };
}
