/**
 * 截取 C# 引用分析工具 UI 界面截图，供 README / 文档使用。
 * 运行前需先启动服务：dotnet run
 * 运行：node scripts/capture-ui-screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const samplesPath = join(root, 'samples');
const outDir = join(root, 'docs', 'screenshots');
const baseUrl = 'http://127.0.0.1:8780';

/** @param {import('playwright').Page} page */
async function waitForAnalyzeDone(page) {
  await page.waitForFunction(() => {
    const btn = document.getElementById('analyzeBtn');
    return btn instanceof HTMLButtonElement && btn.textContent === '分析' && !btn.disabled;
  }, { timeout: 60000 });
  await page.waitForSelector('#statsBar:not(.hidden)', { timeout: 60000 });
  await page.waitForSelector('.class-card', { timeout: 60000 });
}

/** @param {import('playwright').Page} page @param {string} name */
async function shot(page, name) {
  const filePath = join(outDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`[screenshot] 已保存: ${filePath}`);
}

/**
 * 在节点图区域滚轮放大，以 AppRunner 卡片为焦点，便于展示类卡片与引用边
 * @param {import('playwright').Page} page
 * @param {number} steps 滚轮次数（负 deltaY = 放大）
 */
async function zoomGraphView(page, steps = 6) {
  await page.waitForSelector('.graph-node-card', { timeout: 15000 });

  const focused = await page.evaluate((wheelSteps) => {
    const cards = [...document.querySelectorAll('.graph-node-card')];
    const targetCard = cards.find((card) => card.textContent?.includes('AppRunner'))
      ?? cards.find((card) => card.textContent?.includes('Human'))
      ?? cards[Math.floor(cards.length / 2)];

    if (!targetCard) {
      return { ok: false, reason: '未找到可聚焦的节点卡片' };
    }

    const rect = targetCard.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const graphContainer = document.getElementById('graphContainer');
    if (!graphContainer) {
      return { ok: false, reason: 'graphContainer 不存在' };
    }

    for (let i = 0; i < wheelSteps; i += 1) {
      graphContainer.dispatchEvent(new WheelEvent('wheel', {
        clientX,
        clientY,
        deltaY: -120,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
      }));
    }

    return {
      ok: true,
      target: targetCard.textContent?.trim().slice(0, 40) ?? 'unknown',
      steps: wheelSteps,
    };
  }, steps);

  if (!focused.ok) {
    throw new Error(focused.reason ?? '节点图缩放失败');
  }

  await page.waitForTimeout(700);
  console.log(`[screenshot] 节点图已以「${focused.target}」为中心放大 ${focused.steps} 次`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 960 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  console.log(`[screenshot] 打开 ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 1. 初始空状态
  await shot(page, '01-initial');

  // 2. 分析 samples 后 — 分层视图
  await page.fill('#folderPath', samplesPath);
  await page.click('#analyzeBtn');
  await waitForAnalyzeDone(page);
  await page.waitForTimeout(800);
  await shot(page, '02-layers-view');

  // 3. 节点图视图
  await page.click('.view-toggle-btn[data-view="graph"]');
  await page.waitForSelector('#graphContainer:not(.hidden)', { timeout: 15000 });
  await page.waitForSelector('#graphCyRoot canvas', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot(page, '03-graph-view');

  // 3b. 节点图放大后（滚轮缩放）
  await zoomGraphView(page, 6);
  await shot(page, '06-graph-view-zoomed');

  // 4. 回到分层视图，点击 AppRunner 展示类概要
  await page.click('.view-toggle-btn[data-view="layers"]');
  await page.waitForSelector('#layersContainer:not(.hidden)', { timeout: 10000 });
  const appRunnerCard = page.locator('.class-card').filter({ hasText: 'AppRunner' }).first();
  await appRunnerCard.click();
  await page.waitForSelector('#treeContainer .summary-section', { timeout: 15000 });
  await page.waitForSelector('#treeContainer .summary-type-name', { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot(page, '04-class-outline');

  // 5. 帮助弹窗
  await page.click('#openHelpBtn');
  await page.waitForSelector('#helpModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(300);
  await shot(page, '05-help-modal');

  await browser.close();
  console.log('[screenshot] 全部完成，输出目录:', outDir);
}

main().catch((err) => {
  console.error('[screenshot] 失败:', err);
  process.exit(1);
});
