// Layout regression test in a real browser (jsdom does no layout, which is how the resize bug got through).
// Drags the divider across widths, at several window sizes, on every tab, and fails on overlap or clipping.
//   node scripts/layout-check.mjs        (exit code 1 when anything is wrong)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const failures = [];
let checks = 0;

const WINDOWS = [[1280, 720], [1024, 700], [1440, 900], [900, 640]];
const EDITOR_X = [270, 360, 460, 560, 700]; // where the divider is dragged to
const TABS = { visualisation: 1, output: 2, compare: 3 };

/** Do these two boxes (in page pixels) overlap by more than a hair? */
const overlap = (a, b) => a && b && a.x + 1 < b.x + b.width && b.x + 1 < a.x + a.width && a.y + 1 < b.y + b.height && b.y + 1 < a.y + a.height;

for (const [w, h] of WINDOWS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('http://localhost:5198/');
  await page.waitForFunction(() => window.__dev);
  const stacked = w <= 860; // the narrow-window layout stacks the editor above the work area, and has no divider
  const widths = stacked ? [null] : EDITOR_X;

  for (const x of widths) {
    if (x !== null) {
      const box = await page.locator('.divider').boundingBox();
      await page.mouse.move(box.x + 4, box.y + 200);
      await page.mouse.down();
      await page.mouse.move(x, box.y + 200, { steps: 5 });
      await page.mouse.up();
    }
    for (const [tab, n] of Object.entries(TABS)) {
      await page.evaluate(() => {
        const { viz, programs } = window.__dev;
        const p = programs.find((q) => q.name === 'add two numbers');
        viz.loadImage(p.name, p.load(), p.source);
      });
      await page.click(`.work > .tabs .tab:nth-child(${n})`);
      await page.waitForTimeout(tab === 'compare' ? 700 : 250);
      const where = `${w}x${h}, editor dragged to ${x ?? 'n/a'}px, ${tab} tab`;
      const rect = (sel) => page.locator(sel).first().boundingBox().catch(() => null);
      const work = await rect('.work');
      checks++;

      // 1. the work area keeps at least 560px (unless the window itself is narrower)
      if (!stacked && work.width < 559) failures.push(`${where}: the work area is only ${Math.round(work.width)}px wide`);

      // 2. nothing in the pane sticks out past its right edge or is clipped by it
      const sticks = await page.evaluate((tabName) => {
        const pane = document.querySelector('.tab-pane:not([hidden])');
        const limit = pane.getBoundingClientRect().right + 1;
        const bad = [];
        for (const el of pane.querySelectorAll('.vis-note, .numin, .dp, .mm, .console, .screen, .out-input, .cmp-top, .cmp-card, .cmp-chart-svg, .cmp-table, .tbar')) {
          if (el.closest('[hidden]') || !el.getClientRects().length) continue;
          const r = el.getBoundingClientRect();
          if (r.right > limit && !el.closest('.cmp-table')) bad.push(`${el.className.baseVal ?? el.className} ends at ${Math.round(r.right)} > ${Math.round(limit)}`);
        }
        return bad;
      });
      for (const s of sticks) failures.push(`${where}: ${s}`);

      // 3. blocks in the Visualisation tab do not overlap each other
      if (tab === 'visualisation') {
        const names = ['.vis-note', '.vis .numin', '.vis-dp', '.vis .mm'];
        const boxes = await Promise.all(names.map(rect));
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            if (overlap(boxes[i], boxes[j])) failures.push(`${where}: ${names[i]} overlaps ${names[j]}`);
          }
        }
        // the diagram keeps its shape and a readable size, and the memory column is not squeezed to nothing
        const dp = await rect('.vis-dp .dp');
        if (dp && dp.width < 300) failures.push(`${where}: the diagram is only ${Math.round(dp.width)}px wide`);
        const mm = await rect('.vis .mm');
        if (mm && mm.width < 320) failures.push(`${where}: the memory table is only ${Math.round(mm.width)}px wide`);
        // the note text is not squeezed into a column
        const note = await rect('.vis-note');
        if (note && note.width < 240) failures.push(`${where}: the note is only ${Math.round(note.width)}px wide`);
        // row labels and numbers are not cut off by their cells
        const clipped = await page.evaluate(() => [...document.querySelectorAll('.vis .mm-cell, .vis .mm-addr')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
        if (clipped) failures.push(`${where}: ${clipped} memory cells are clipped`);
      }

      // 4. the debug bar: t, the track and the state fit in one row
      const bar = await rect('.debugbar .tbar-row');
      if (bar && x !== null && x >= 270) {
        const trackBox = await rect('.debugbar .tbar-track');
        if (trackBox && trackBox.width < 40) failures.push(`${where}: the time bar track is only ${Math.round(trackBox.width)}px`);
      }

      // 5. the page itself does not scroll sideways
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (sideways > 0) failures.push(`${where}: the page scrolls sideways by ${sideways}px`);
    }
  }
  await page.close();
}

await browser.close();
await server.close();
console.log(`${checks} layouts checked`);
if (failures.length) {
  console.log(`FAILED (${failures.length}):\n` + failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
console.log('no overlaps, no clipping');
