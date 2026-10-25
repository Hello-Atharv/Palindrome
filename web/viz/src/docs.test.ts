// @vitest-environment node
// Every document the Docs tab lists must load, render, and have links that go somewhere.
// @ts-ignore this package has no Node type definitions; this test file runs in Node and only needs existsSync
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DOCS, REPO_URL, loadDoc, renderMarkdown, resolveLink, sanitize, slug } from './docs';

describe('the Docs tab', () => {
  it('bundles and renders every listed document', async () => {
    for (const d of DOCS) {
      const src = await loadDoc(d.path);
      expect(src, d.path).not.toBeNull();
      const html = renderMarkdown(src!);
      expect(html, d.path).toMatch(/<h1 id="[^"]+">/);
      expect(html, d.path).not.toMatch(/<script/i);
    }
  });

  it('every relative link in every document resolves to a bundled document or the repository', async () => {
    const dead: string[] = [];
    for (const d of DOCS) {
      const html = renderMarkdown((await loadDoc(d.path))!);
      for (const m of html.matchAll(/<a href="([^"]+)"/g)) {
        const link = resolveLink(d.path, m[1].replace(/&amp;/g, '&'));
        if (link.kind === 'repo' && /\/(blob|tree)\/main\/(\.\.|undefined)/.test(link.url)) dead.push(`${d.path}: ${m[1]}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('every link that leaves the app points at a file or folder that exists in the repository', async () => {
    const missing: string[] = [];
    for (const d of DOCS) {
      const html = renderMarkdown((await loadDoc(d.path))!);
      for (const m of html.matchAll(/<a href="([^"]+)"/g)) {
        const link = resolveLink(d.path, m[1].replace(/&amp;/g, '&'));
        if (link.kind !== 'repo') continue;
        const rel = link.url.slice(link.url.indexOf('/main/') + '/main/'.length);
        if (!existsSync(new URL(`../../../${rel}`, import.meta.url))) missing.push(`${d.path} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('opens on the tour, lists every document once, and groups them under headings', () => {
    expect(DOCS[0].path).toBe('docs/TOUR.md');
    expect(new Set(DOCS.map((d) => d.path)).size).toBe(DOCS.length);
    expect([...new Set(DOCS.map((d) => d.group))]).toEqual(['Start here', 'Understand it', 'Use it', 'Demos', 'The contract and the numbers']);
    // a group is one run in the list, so its heading is drawn once
    const order = DOCS.map((d) => d.group).filter((g, i, all) => i === 0 || g !== all[i - 1]);
    expect(order.length).toBe(new Set(order).size);
  });

  it('resolves links the way the documents write them', () => {
    expect(resolveLink('docs/README.md', 'GUIDE.md')).toEqual({ kind: 'doc', path: 'docs/GUIDE.md', hash: '' });
    expect(resolveLink('docs/README.md', '../spec/SPEC.md#12-cost-model')).toEqual({ kind: 'doc', path: 'spec/SPEC.md', hash: '12-cost-model' });
    expect(resolveLink('README.md', 'docs/GUIDE.md')).toEqual({ kind: 'doc', path: 'docs/GUIDE.md', hash: '' });
    expect(resolveLink('README.md', 'cli/README.md')).toEqual({ kind: 'doc', path: 'cli/README.md', hash: '' }); // a package doc that is bundled opens in place
    expect(resolveLink('README.md', 'asm/README.md')).toEqual({ kind: 'repo', url: `${REPO_URL}/blob/main/asm/README.md` });
    expect(resolveLink('docs/README.md', '../examples/demos/')).toEqual({ kind: 'repo', url: `${REPO_URL}/tree/main/examples/demos` });
    expect(resolveLink('README.md', 'https://example.com/x')).toEqual({ kind: 'external', url: 'https://example.com/x' });
    expect(resolveLink('README.md', '#what-this-is-not')).toEqual({ kind: 'anchor', hash: 'what-this-is-not' });
  });

  it('gives headings GitHub-style ids, unique within a document', () => {
    expect(slug('7. Garbage: what a reversible program is forced to keep')).toBe('7-garbage-what-a-reversible-program-is-forced-to-keep');
    const html = renderMarkdown('# A\n\n## Same\n\n## Same\n');
    expect(html).toContain('<h2 id="same">');
    expect(html).toContain('<h2 id="same-1">');
  });

  it('removes script, event handlers and javascript: links', () => {
    const dirty = '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">y</a><iframe src="z"></iframe>';
    const clean = sanitize(dirty);
    expect(clean).not.toMatch(/script|onclick|javascript:|iframe/i);
    expect(clean).toContain('hi');
  });
});
