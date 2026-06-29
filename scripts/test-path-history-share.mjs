/**
 * ponytail: 验证 127.0.0.1 与局域网 IP 共用同一份路径历史（API + 页面 UI）
 */
import { chromium } from 'playwright';

const LOCAL = 'http://127.0.0.1:8780';
const LAN = 'http://192.168.110.183:8780';
const TEST_PATH = 'C:\\TestShare\\PlaywrightUiCheck';

async function resetAndSeed() {
  const resp = await fetch(`${LOCAL}/api/path-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: TEST_PATH }),
  });
  if (!resp.ok) {
    throw new Error(`seed failed: ${resp.status}`);
  }
  return resp.json();
}

async function getCardTitles(page) {
  await page.waitForSelector('#pathHistorySection:not(.hidden)', { timeout: 5000 });
  return page.locator('.path-history-card .path-label').allTextContents();
}

async function main() {
  const seeded = await resetAndSeed();
  console.log('[test] seeded server paths:', seeded.paths);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  const pageLocal = await ctx.newPage();
  await pageLocal.goto(LOCAL, { waitUntil: 'networkidle' });
  const localTitles = await getCardTitles(pageLocal);
  console.log('[test] 127.0.0.1 UI cards:', localTitles);

  const pageLan = await ctx.newPage();
  await pageLan.goto(LAN, { waitUntil: 'networkidle' });
  const lanTitles = await getCardTitles(pageLan);
  console.log('[test] LAN UI cards:', lanTitles);

  const localHas = localTitles.some((t) => t.toLowerCase().includes('playwrightuicheck'));
  const lanHas = lanTitles.some((t) => t.toLowerCase().includes('playwrightuicheck'));

  await browser.close();

  if (!localHas || !lanHas) {
    console.error('[test] FAIL: UI 未在两个地址显示同一条测试路径');
    process.exit(1);
  }

  console.log('[test] PASS: 两个地址 UI 均显示共享路径历史');
}

main().catch((err) => {
  console.error('[test] ERROR:', err);
  process.exit(1);
});
