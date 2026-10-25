// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { applyEdit, indentEdit } from './indent';

const tab = (v: string, s: number, e = s, outdent = false) => applyEdit(v, indentEdit(v, s, e, outdent));

describe('Tab and Shift+Tab in the editor', () => {
  it('Tab with the caret inside a line inserts two spaces there and moves the caret after them', () => {
    expect(tab('abc', 1)).toEqual({ value: 'a  bc', selStart: 3, selEnd: 3 });
    expect(tab('', 0)).toEqual({ value: '  ', selStart: 2, selEnd: 2 });
  });

  it('Tab with lines selected indents every line they touch, and keeps them selected', () => {
    const v = 'one\ntwo\nthree';
    expect(tab(v, 1, 9)).toEqual({ value: '  one\n  two\n  three', selStart: 3, selEnd: 15 });
    expect(tab(v, 4, 7).value).toBe('one\n  two\nthree'); // just the middle line
  });

  it('a selection that ends just after a line break does not indent the next line, and empty lines stay empty', () => {
    expect(tab('a\nb\nc', 0, 4).value).toBe('  a\n  b\nc');
    expect(tab('a\n\nb', 0, 4).value).toBe('  a\n\n  b');
  });

  it('Shift+Tab takes up to two spaces (or a tab character) off each line, never more', () => {
    expect(tab('    deep\n  mid\n x', 0, 17, true).value).toBe('  deep\nmid\nx');
    expect(tab('\tx', 1, 1, true).value).toBe('x');
    expect(tab('none', 2, 2, true)).toEqual({ value: 'none', selStart: 2, selEnd: 2 });
  });

  it('Shift+Tab with just a caret outdents that one line and keeps the caret on the same character', () => {
    expect(tab('  ab', 3, 3, true)).toEqual({ value: 'ab', selStart: 1, selEnd: 1 });
    expect(tab('  ab', 1, 1, true)).toEqual({ value: 'ab', selStart: 0, selEnd: 0 }); // caret inside the indent: stays at the line start
  });

  it('indenting then outdenting gives back the original', () => {
    const v = 'x += 1;\n  y -= 2;\nz ^= 3;';
    const a = tab(v, 0, v.length);
    expect(tab(a.value, a.selStart, a.selEnd, true).value).toBe(v);
  });
});
