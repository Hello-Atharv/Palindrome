import { describe, expect, it } from 'vitest';

import { highlightLine, highlightRev } from '../playground/highlight.js';

const has = (html: string, cls: string, text: string): boolean => html.includes(`<span class="${cls}">${text}</span>`);

describe('rev highlighting', () => {
  it('colours declarations, keywords, calls, numbers, operators and comments', () => {
    expect(has(highlightLine('proc step { a += b; }'), 't-decl', 'proc')).toBe(true);
    expect(has(highlightLine('proc step { a += b; }'), 't-fn', 'step')).toBe(true);
    expect(has(highlightLine('proc step { a += b; }'), 't-assign', '+=')).toBe(true);
    expect(has(highlightLine('a <=> b;'), 't-swap', '&lt;=&gt;')).toBe(true);
    const l = highlightLine('if (a > b) { skip; } else { skip; } fi (f != 0);');
    expect(has(l, 't-kw', 'if')).toBe(true);
    expect(has(l, 't-kw', 'fi')).toBe(true);
    expect(has(l, 't-kw', 'skip')).toBe(true);
    expect(has(highlightLine('var x = 0xFF, y = 12;'), 't-num', '0xFF')).toBe(true);
    expect(has(highlightLine('var x = 0xFF, y = 12;'), 't-num', '12')).toBe(true);
    expect(has(highlightLine('call step;'), 't-flow', 'call')).toBe(true);
    expect(has(highlightLine('uncall step;'), 't-fn', 'step')).toBe(true);
    expect(has(highlightLine('x ^= latest + events;'), 't-input', 'latest')).toBe(true);
    expect(has(highlightLine('x += rol(y, 3);'), 't-builtin', 'rol')).toBe(true);
    expect(has(highlightLine('var s @ mem = 3;'), 't-decl', 'mem')).toBe(true);
    expect(has(highlightLine('x += 1; // if and var here'), 't-comment', '// if and var here')).toBe(true);
  });

  it('escapes HTML so source text cannot inject markup', () => {
    const l = highlightLine('a < b && <script>');
    expect(l).not.toContain('<script>');
    expect(l.replace(/<[^>]+>/g, '')).toBe('a &lt; b &amp;&amp; &lt;script&gt;');
  });

  it('keeps every character of the source (the layer must line up with the textarea)', () => {
    const src = 'var x = 0xFF; // c\nproc p { x ^= 1; }\n\nmain { call p; }';
    const text = highlightRev(src).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#8203;/g, '');
    expect(text).toBe(src + '\n');
  });

  it('underlines the lines with errors and carries the message', () => {
    const html = highlightRev('var x;\nx += x;\n', new Map([[2, 'both sides "x"']]));
    expect(html).toContain('class="t-err" title="both sides &quot;x&quot;"');
    expect(html.split('\n')[0]).not.toContain('t-err');
  });
});
