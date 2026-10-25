import { DOCS, loadDoc, renderMarkdown, resolveLink } from '../docs';
import { h } from '../dom';

/**
 * The Docs tab: a list of the project's documents on the left, the chosen one rendered on the right. Links between documents open
 * in place; other links open the repository or the web in a new tab.
 */
export function docsPanel(): { el: HTMLElement; open(path: string, hash?: string): Promise<void> } {
  const el = h('section', 'docs');
  el.setAttribute('aria-label', 'documentation');

  const nav = h('nav', 'docs-nav');
  nav.setAttribute('aria-label', 'documents');
  const buttons = new Map<string, HTMLButtonElement>();
  for (const d of DOCS) {
    const b = h('button', 'docs-item');
    b.type = 'button';
    b.append(h('span', 'docs-item-title', d.title), h('span', 'docs-item-blurb', d.blurb));
    b.addEventListener('click', () => void open(d.path));
    nav.append(b);
    buttons.set(d.path, b);
  }

  const body = h('div', 'docs-body');
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', 'document');
  const page = h('article', 'docs-md');
  body.append(page);
  el.append(nav, body);

  let current = '';

  function scrollToHash(hash: string): void {
    const target = hash ? page.querySelector<HTMLElement>(`[id="${CSS.escape(hash)}"]`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else body.scrollTop = 0;
  }

  async function open(path: string, hash = ''): Promise<void> {
    if (path !== current) {
      const src = await loadDoc(path);
      current = path;
      buttons.forEach((b, p) => (p === path ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
      if (src === null) {
        page.replaceChildren(h('p', '', `This document is not bundled in the app: ${path}`));
      } else {
        page.innerHTML = renderMarkdown(src); // our own files, bundled at build time and sanitised
        page.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
          const link = resolveLink(path, a.getAttribute('href') ?? '');
          if (link.kind === 'doc') {
            a.dataset.doc = link.path;
            a.dataset.hash = link.hash;
            a.href = `#${link.hash}`;
          } else if (link.kind === 'repo' || link.kind === 'external') {
            a.href = link.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          }
        });
      }
    }
    scrollToHash(hash);
  }

  page.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>('a');
    if (!a) return;
    if (a.dataset.doc) {
      ev.preventDefault();
      void open(a.dataset.doc, a.dataset.hash ?? '');
    } else if (a.getAttribute('href')?.startsWith('#')) {
      ev.preventDefault();
      scrollToHash(a.getAttribute('href')!.slice(1));
    }
  });

  void open(DOCS[0].path);
  return { el, open };
}
