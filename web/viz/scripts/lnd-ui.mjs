// Reproduces the pong.rev "LND assertion failed" in the app, with the Diary (logging) engine, from the UI's own API.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.clear());
await page.goto(url);
await page.waitForFunction(() => window.__dev);
for (const engine of ['logging', 'reversible']) {
  await page.evaluate((n) => { const { viz, programs } = window.__dev; const p = programs.find((q) => q.name === 'pong (rev)'); viz.loadImage(n, p.load(), p.source); }, 'pong (rev)');
  await page.evaluate((k) => window.__dev.viz.setEngine(k), engine);
  const out = await page.evaluate(() => {
    const v = window.__dev.viz;
    v.pushInput(0x80);                              // press Up at t = 0
    while (v.snapshot.t < 3108) v.step();           // run on to t = 3108 (part-way through a frame)
    v.pushInput(0x57);                              // press W at t = 3108
    let s = 'ok';
    for (let i = 0; i < 600 && s === 'ok'; i++) s = v.step();
    return { status: s, t: v.snapshot.t, error: v.vm.lastError, banner: document.querySelector('.banner.fault')?.textContent ?? '', engine: v.vm.kind };
  });
  console.log(`${engine.padEnd(10)} ${out.status === 'fault' ? `FAULT at t=${out.t}: ${out.error} | banner: "${out.banner}"` : `no fault (t=${out.t}, ${out.status})`}`);
  if (out.status === 'fault') await page.screenshot({ path: 'screenshots/lnd-fault.png' });
}
await browser.close();
