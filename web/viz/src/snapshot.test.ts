import { describe, expect, it } from 'vitest';
import { keyCode, describeKey, KEY_UP_FLAG } from './keys';
import { inspectImage } from './program';
import { changedRegs, changedWords } from './snapshot';
import type { Snapshot } from './snapshot';

const snap = (regs: number[]): Snapshot => ({
  t: 0, pc: 0, regs: Uint32Array.from(regs), direction: 1, historyBytes: 0, lastError: '', status: 'ok', fb: new Uint32Array(0),
});

describe('snapshot diffs', () => {
  it('flags changed registers, and none without a previous snapshot', () => {
    const a = snap([1, 2, 3]);
    const b = snap([1, 9, 3]);
    expect(changedRegs(a, b)).toEqual([false, true, false]);
    expect(changedRegs(null, b)).toEqual([false, false, false]);
  });

  it('flags changed words only for equal-length arrays', () => {
    expect([...changedWords(Uint32Array.of(1, 2, 3), Uint32Array.of(1, 5, 3))]).toEqual([1]);
    expect(changedWords(null, Uint32Array.of(1)).size).toBe(0);
    expect(changedWords(Uint32Array.of(1), Uint32Array.of(1, 2)).size).toBe(0);
  });
});

describe('keys', () => {
  it('maps keys to codes and describes them', () => {
    expect(keyCode('a')).toBe(0x41);
    expect(keyCode('ArrowLeft')).toBe(0x82);
    expect(keyCode(' ')).toBe(0x20);
    expect(keyCode('Shift')).toBeNull();
    expect(describeKey(0x41)).toBe('A down');
    expect(describeKey(0x20 | KEY_UP_FLAG)).toBe('Space up');
  });
});

describe('inspectImage', () => {
  it('reads code length, entry and code labels from the header and symbol table', () => {
    const name = new TextEncoder().encode('start');
    const bytes = new Uint8Array(32 + 8 + 6 + name.length);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(8, 1, true); // entry
    dv.setUint32(12, 2, true); // code_len
    dv.setUint32(20, 6 + name.length, true); // sym_len
    dv.setUint32(40, 1, true); // symbol addr
    bytes[44] = 0; // kind: code
    bytes[45] = name.length;
    bytes.set(name, 46);
    const info = inspectImage('x', bytes);
    expect(info.codeLen).toBe(2);
    expect(info.entry).toBe(1);
    expect(info.labels.get(1)).toBe('start');
  });

  it('survives garbage', () => {
    expect(inspectImage('x', new Uint8Array(3)).codeLen).toBe(0);
  });
});
