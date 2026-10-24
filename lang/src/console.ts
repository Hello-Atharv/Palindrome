// Reading the console (SPEC 11.9) back out of machine memory. Browser-safe, no dependencies: give it a function that reads memory
// (any RVM's `memory`) and it returns what the program has printed so far. Because the text lives in memory, calling this at an
// earlier time shows less text: stepping back un-prints.

export const OUT_BASE = 0xe000;
export const OUT_LEN = 0xfffe;
export const OUT_CAPACITY = 0x1ffe; // words

/** Entry tags. */
export const TAG = { char: 0, unsigned: 1, signed: 2, hex: 3 } as const;

export interface ConsoleEntry {
  tag: number;
  value: number;
}

export type ReadMemory = (addr: number, words: number) => ArrayLike<number>;

/** The entries printed so far. */
export function readConsole(read: ReadMemory): ConsoleEntry[] {
  const used = Math.min(read(OUT_LEN, 1)[0] >>> 0, OUT_CAPACITY) & ~1; // always even
  if (used === 0) return [];
  const words = read(OUT_BASE, used);
  const out: ConsoleEntry[] = [];
  for (let i = 0; i < used; i += 2) out.push({ tag: words[i] >>> 0, value: words[i + 1] >>> 0 });
  return out;
}

/** One entry as text. */
export function formatEntry(e: ConsoleEntry): string {
  switch (e.tag) {
    case TAG.char: return e.value <= 0x10ffff ? String.fromCodePoint(e.value) : '�';
    case TAG.unsigned: return String(e.value >>> 0);
    case TAG.signed: return String(e.value | 0);
    case TAG.hex: return '0x' + (e.value >>> 0).toString(16);
    default: return `<tag ${e.tag}: ${e.value}>`;
  }
}

/** Everything printed so far, as one string (a character 10 starts a new line). */
export const consoleText = (read: ReadMemory): string => readConsole(read).map(formatEntry).join('');
