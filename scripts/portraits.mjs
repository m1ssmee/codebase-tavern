#!/usr/bin/env node
// npm run portraits: every archetype (the Landlord and the Judge too) in every palette colour, as a small neutral
// WebP portrait in public/portraits/<archetype>-<hex>.webp, rendered from the 3D models on /lab?portraits=1.
// Uses a running dev server (PORTRAITS_URL, e.g. http://localhost:3000) or starts `next dev` on a free port.
// Needs Chrome, or Playwright's Chromium (npx playwright-core install chromium).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'portraits');

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let server = null;
let base = process.env.PORTRAITS_URL;
if (!base) {
  const port = await freePort();
  base = `http://localhost:${port}`;
  console.log(`Starting next dev on ${port}…`);
  server = spawn('npx', ['next', 'dev', '-p', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '', OPENAI_API_KEY_BACKUP: '' } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('next dev did not start in 90 s')), 90_000);
    server.stdout.on('data', (d) => /Ready|ready/.test(String(d)) && (clearTimeout(t), resolve()));
    server.on('exit', (code) => reject(new Error(`next dev exited (${code})`)));
  });
}

const launch = () => chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] }));
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${base}/lab?portraits=1`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__portraits?.done, null, { timeout: 180_000, polling: 500 });
  const files = await page.evaluate(() => window.__portraits.files);
  mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  for (const [name, url] of Object.entries(files)) {
    if (!url.startsWith('data:image/webp;base64,')) throw new Error(`${name}: not a WebP (${url.slice(0, 30)})`);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(join(outDir, `${name}.webp`), buf);
    bytes += buf.length;
  }
  console.log(`Wrote ${Object.keys(files).length} portraits to public/portraits/ (${Math.round(bytes / 1024)} KB).`);
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}
