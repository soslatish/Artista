// Рендер интерьеров примерки: node scripts/rooms/render.mjs [папка-вывода]
// Нужен playwright с chromium (npx playwright install chromium). Пишет assets/rooms/<name>.jpg
// и печатает геометрию сцен для src/features/try-on-rooms.ts.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { FLOOR, H, K, scenes, W } from './scenes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, '../../assets/rooms'));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [name, scene] of Object.entries(scenes)) {
  await page.setContent(`<html><body style="margin:0">${scene.draw()}</body></html>`);
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: W, height: H } });
  console.log(name, JSON.stringify({ width: W, height: H, pxPerCm: K, floorY: FLOOR, wallX: scene.wallX, surface: scene.surface }));
}
await browser.close();
