/**
 * The project's own Markdown (README, docs/, the spec, the benchmark tables) shown inside the app. The files are bundled at build time,
 * so the Docs tab works offline and on the deployed site, and there is one copy of every document: the one in the repository.
 * Pure functions only (no DOM), so they can be tested without a browser; panels/docs.ts is the view.
 */
import { Renderer, marked } from 'marked';

export interface DocEntry {
  /** Path from the repository root: the key, and what relative links are resolved against. */
  path: string;
  title: string;
  blurb: string;
  /** The heading it is listed under. */
  group: string;
}

/**
 * What the tab lists, grouped, in reading order. A judge with five minutes reads the first group; a developer finds the rest.
 * Package documents that live next to their code (the debugger in cli/, the extension in vscode/) are listed here too, so every
 * document is reachable from the app.
 */
export const DOCS: readonly DocEntry[] = [
  { group: 'Start here', path: 'docs/TOUR.md', title: 'Tour', blurb: 'Five minutes: what to click and what you will see' },
  { group: 'Start here', path: 'docs/REFERENCE.md', title: 'Reference', blurb: 'Every command, control and feature' },
  { group: 'Understand it', path: 'README.md', title: 'Overview', blurb: 'What this is, how to try it, the numbers' },
  { group: 'Understand it', path: 'docs/GUIDE.md', title: 'Guide', blurb: 'Every idea from zero' },
  { group: 'Understand it', path: 'docs/WRITEUP.md', title: 'Writeup', blurb: 'The story, including what went wrong' },
  { group: 'Understand it', path: 'docs/ARCHITECTURE.md', title: 'Architecture', blurb: 'How the pieces fit' },
  { group: 'Use it', path: 'cli/README.md', title: 'Command line and debugger', blurb: 'rvm, and every debugger command' },
  { group: 'Use it', path: 'docs/LANGUAGE.md', title: 'The rev language', blurb: 'Statements, fi, loops, the cost report' },
  { group: 'Use it', path: 'spec/asm_syntax.md', title: 'Assembly syntax', blurb: 'The instructions and every macro' },
  { group: 'Use it', path: 'vscode/README.md', title: 'VS Code extension', blurb: 'Colours, errors and the cost beside each line' },
  { group: 'Demos', path: 'docs/DEMO.md', title: 'Demo script', blurb: 'What to click and say, beat by beat' },
  { group: 'Demos', path: 'examples/demos/README.md', title: 'Demo programs', blurb: 'The cipher, the sort, Pong, and how they work' },
  { group: 'The contract and the numbers', path: 'spec/SPEC.md', title: 'Machine spec', blurb: 'The instructions, memory map and cost model' },
  { group: 'The contract and the numbers', path: 'bench/TWINS.md', title: 'Benchmarks', blurb: 'The fair comparison, with the method' },
  { group: 'The contract and the numbers', path: 'bench/RESULTS.md', title: 'Engine speed', blurb: 'How fast each engine steps and rewinds' },
];

export const REPO_URL = 'https://github.com/Hello-Atharv/Palindrome';

// Vite bundles each file as its own lazy chunk, fetched the first time it is opened.
const sources = import.meta.glob(
  [
    '../../../README.md',
    '../../../docs/*.md',
    '../../../spec/SPEC.md',
    '../../../spec/asm_syntax.md',
    '../../../bench/TWINS.md',
    '../../../bench/RESULTS.md',
    '../../../cli/README.md',
    '../../../vscode/README.md',
    '../../../examples/demos/README.md',
  ],
  {
    query: '?raw',
    import: 'default',
  },
) as Record<string, () => Promise<string>>;

/** The Markdown source of a document, or null if it is not bundled. */
export async function loadDoc(path: string): Promise<string | null> {
  const load = sources[`../../../${path}`];
  return load ? load() : null;
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/** Drop anything that can run script. The documents are our own, so this is belt and braces. */
export function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\b(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** Markdown to HTML, with an id on every heading so links like `GUIDE.md#7-garbage` can scroll to it. */
export function renderMarkdown(src: string): string {
  const seen = new Map<string, number>();
  const renderer = new Renderer();
  renderer.heading = function ({ tokens, depth, text }) {
    const base = slug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };
  return sanitize(marked.parse(src, { async: false, gfm: true, renderer }) as string);
}

export type Link =
  | { kind: 'anchor'; hash: string }
  | { kind: 'doc'; path: string; hash: string }
  | { kind: 'repo'; url: string }
  | { kind: 'external'; url: string };

/** Where a link written in the document at `from` goes: another bundled document, a place on this page, the repository, or the web. */
export function resolveLink(from: string, href: string): Link {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'external', url: href };
  if (href.startsWith('#')) return { kind: 'anchor', hash: href.slice(1) };
  const [target, hash = ''] = href.split('#');
  const parts = from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  const path = parts.join('/');
  if (DOCS.some((d) => d.path === path)) return { kind: 'doc', path, hash };
  const folder = target.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(path);
  return { kind: 'repo', url: `${REPO_URL}/${folder ? 'tree' : 'blob'}/main/${path}` };
}
