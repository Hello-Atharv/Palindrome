// Screenshots of the engine cues and a check that the .s | .rev switch keeps its place when the program changes.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.clear());
await page.goto('http://localhost:5196/');
await page.waitForFunction(() => window.__dev);
const load = (n) => page.evaluate((name) => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === name); viz.loadImage(name, p.load(), p.source); }, n);
const box = (sel) => page.locator(sel).first().boundingBox();
const out = join(root, 'screenshots');

await load('pong');
await page.waitForTimeout(300);
const withTwin = { build: await box('.ed-build'), follow: await box('.ed-follow'), variant: await box('.variant') };
await page.screenshot({ path: join(out, 'e1-diary-pong.png') });
await load('loop');
await page.waitForTimeout(300);
const noTwin = { build: await box('.ed-build'), follow: await box('.ed-follow'), variant: await box('.variant'), visible: await page.evaluate(() => getComputedStyle(document.querySelector('.variant')).visibility) };
const same = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 0.5);
const editorBox = await box('.editor');
console.log(`switch visible with a twin; hidden without (${noTwin.visible}); Build moved: ${!same(withTwin.build, noTwin.build)}; Follow moved: ${!same(withTwin.follow, noTwin.follow)}; switch moved: ${!same(withTwin.variant, noTwin.variant)}; switch right edge ${Math.round(withTwin.variant.x + withTwin.variant.width)} of editor right edge ${Math.round(editorBox.x + editorBox.width)}`);

await load('add two numbers');
await page.click('.engine-switch .seg[data-kind="reversible"]');
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'e2-reversible.png') });
await page.click('.compare-btn');
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'e3-compare-strip.png') });
// narrow editor: does the header still fit?
await page.click('.compare-btn');
const d = await box('.divider');
await page.mouse.move(d.x + 4, d.y + 200); await page.mouse.down(); await page.mouse.move(120, d.y + 200, { steps: 4 }); await page.mouse.up();
await load('pong');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'e4-narrow-editor.png'), clip: { x: 0, y: 0, width: 640, height: 120 } });
const fits = await page.evaluate(() => { const t = document.querySelector('.ed-tab'); return t.scrollWidth <= t.clientWidth + 1; });
console.log(`narrow editor header fits: ${fits}`);
await browser.close();
await server.close();
