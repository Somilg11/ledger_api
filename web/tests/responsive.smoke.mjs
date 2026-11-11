/** Production-browser checks for layout, navigation, metadata, caching, and route recovery. */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = process.env.DEMO_PASSWORD || 'Sup3rStrong!Pass';
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }
);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const problems = [];
page.on('pageerror', (error) => problems.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource'))
    problems.push(message.text());
});
let checks = 0;
async function check(name, work) {
  await work();
  checks += 1;
  console.log(`PASS ${name}`);
}
async function login(target, email = 'alice@example.com') {
  await target.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await target.getByLabel('Email', { exact: true }).fill(email);
  await target.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await target.getByRole('button', { name: 'Sign in', exact: true }).click();
  await target.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
}
async function noOverflow(target) {
  const metrics = await target.evaluate(() => {
    const main = document.querySelector('main');
    return {
      path: window.location.pathname,
      width: innerWidth,
      documentX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      mainX: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  assert.ok(metrics.documentX <= 2 && metrics.documentY <= 2 && metrics.mainX <= 2, JSON.stringify(metrics));
}
try {
  await check(
    'frontend enforces CSP, private responses, immutable assets, and strict missing-asset handling',
    async () => {
      const response = await fetch(`${BASE}/login`);
      assert.equal(response.status, 200);
      const csp = response.headers.get('content-security-policy') || '';
      assert.ok(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"));
      assert.ok(!csp.includes('unsafe-eval'));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      const html = await response.text();
      assert.ok(!html.includes('fonts.googleapis.com'));
      const script = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
      const asset = await fetch(`${BASE}${script}`);
      assert.ok(asset.headers.get('cache-control').includes('immutable'));
      assert.equal((await fetch(`${BASE}/assets/no-such-chunk.js`)).status, 404);
      assert.ok((await fetch(`${BASE}/api/v1/accounts`)).headers.get('cache-control').includes('no-store'));
    }
  );
  await check('login defers playground code and public demo has safe metadata', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    assert.ok((await page.title()).includes('Sign in'));
    const resources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name)
    );
    assert.ok(!resources.some((name) => /\/Playground-[^/]+\.js/.test(name)));
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow');
    await page.goto(`${BASE}/demo?source=browser-test`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${BASE}/demo`);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index,follow');
    assert.ok((await page.locator('meta[name="description"]').getAttribute('content')).includes('Ledger'));
  });
  await login(page);
  await check('sessions are tab scoped and no credentials persist in localStorage', async () => {
    const stored = await page.evaluate(() => ({
      local: localStorage.getItem('ledger.session'),
      tab: Boolean(sessionStorage.getItem('ledger.session')),
    }));
    assert.equal(stored.local, null);
    assert.equal(stored.tab, true);
    const other = await context.newPage();
    await other.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    await other.getByRole('heading', { name: 'Ledger', exact: true }).waitFor();
    await other.close();
  });
  await check('shadcn selects and a confirmed posting render a clean data-flow diagram', async () => {
    await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
    await page.getByTestId('play-account-0').waitFor();
    await page.getByRole('region', { name: 'Money data-flow diagram', exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Operation', { exact: true }).evaluate((element) => element.tagName),
      'BUTTON'
    );
    await page.getByLabel('Operation', { exact: true }).click();
    await page.getByRole('option', { name: 'Deposit', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByLabel('Amount (INR)', { exact: true }).fill('1.00');
    await page.getByRole('button', { name: 'Run transfer', exact: true }).click();
    await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === 'Refresh balances' && !button.disabled
      )
    );
    await page.screenshot({ path: `${OUT}/21-data-flow.png` });
  });
  const routes = ['/', '/accounts', '/transfer', '/transactions', '/ledger', '/playground'];
  for (const width of [320, 390, 768, 1024, 1440]) {
    await check(`all signed-in screens fit ${width}px without an extra document scrollbar`, async () => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
        await noOverflow(page);
      }
      if (width === 390) {
        await page.screenshot({ path: `${OUT}/22-data-flow-mobile.png` });
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).waitFor();
        await page.getByRole('link', { name: 'Accounts', exact: true }).click();
        await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
        assert.equal(
          await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).count(),
          0
        );
      }
    });
  }
  await check('collapsed sidebar icons are square, centered, and retain accessible tooltips', async () => {
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.waitForTimeout(250);
    const icons = await page.locator('aside nav a').evaluateAll((links) =>
      links.map((link) => {
        const row = link.getBoundingClientRect();
        const icon = link.querySelector('svg').getBoundingClientRect();
        return {
          w: row.width,
          h: row.height,
          dx: Math.abs(row.x + row.width / 2 - icon.x - icon.width / 2),
          dy: Math.abs(row.y + row.height / 2 - icon.y - icon.height / 2),
          display: getComputedStyle(link).display,
        };
      })
    );
    assert.ok(
      icons.every(
        (icon) => icon.w === 36 && icon.h === 36 && icon.dx < 1 && icon.dy < 1 && icon.display === 'flex'
      ),
      JSON.stringify(icons)
    );
    await page.getByRole('link', { name: 'Accounts', exact: true }).hover();
    await page.getByRole('tooltip', { name: 'Accounts', exact: true }).waitFor();
    await page.screenshot({ path: `${OUT}/23-fixed-collapsed-sidebar.png` });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('aside[data-collapsed="true"]').waitFor();
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  });
  await check('short desktop viewports keep one outer scroll owner', async () => {
    await page.setViewportSize({ width: 1440, height: 650 });
    await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' });
    await noOverflow(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await check('a failed lazy route shows a safe boundary and other navigation recovers', async () => {
    const failed = await context.newPage();
    failed.setDefaultTimeout(10_000);
    await login(failed);
    await failed.route('**/assets/Accounts-*.js', (route) => route.abort('failed'));
    await failed.getByRole('link', { name: 'Accounts', exact: true }).click();
    await failed.getByRole('heading', { name: 'This page could not load', exact: true }).waitFor();
    assert.ok(
      !/TypeError|Failed to fetch dynamically imported module/.test(await failed.locator('body').innerText())
    );
    await failed.getByRole('link', { name: 'Ledger', exact: true }).click();
    await failed.getByRole('heading', { name: 'Ledger', exact: true }).waitFor();
    await failed.close();
  });
  assert.deepEqual(problems, []);
  console.log(`\n${checks} responsive/recovery/security browser checks passed`);
} catch (error) {
  await page.screenshot({ path: `${OUT}/fail-responsive.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
