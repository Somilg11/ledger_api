/**
 * UI smoke test for the Ledger Console.
 *
 * Drives a real browser through every screen and asserts the behaviour that a
 * type check cannot: that the money shown is the money the API holds, that the
 * idempotency replay really moves money once, and that a normal user never
 * sees the admin surface.
 *
 * Prerequisites: the API, the seed data and the dev server.
 *
 *   npm run seed
 *   npm run stack:up     (console on :8080)   or   npm run web:dev  (:5173)
 *   npm run test:ui
 *
 * The console port is detected automatically; override with BASE_URL. Uses the
 * locally installed Google Chrome; override with CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The console runs on :5173 under `npm run web:dev` and on :8080 when served by
 * nginx in Docker. Probing both means the suite works either way instead of
 * burning a 30s timeout on every step against a port nobody is listening on.
 */
async function resolveBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL;

  for (const candidate of ['http://localhost:5173', 'http://localhost:8080']) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return candidate;
    } catch {
      // Not listening; try the next one.
    }
  }

  console.error(
    'No console found on :5173 or :8080.\n' +
      '  Docker:  npm run stack:up\n' +
      '  Local:   npm run web:dev\n' +
      '  Or set BASE_URL to point somewhere else.'
  );
  process.exit(1);
}

const BASE = await resolveBaseUrl();
// Resolved from this file, so the run works from any working directory.
const OUT = process.env.OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PASSWORD = process.env.DEMO_PASSWORD || 'Sup3rStrong!Pass';
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const shot = async (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

// channel:'chrome' uses the installed browser, so no 300MB download is needed.
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// A step that cannot find its target is a failure, not something worth waiting
// half a minute for.
page.setDefaultTimeout(10_000);

page.on('console', (m) => {
  // Non-2xx fetches log here too; several of the checks below expect a 4xx.
  const text = m.text();
  if (m.type() === 'error' && !text.includes('Failed to load resource')) {
    problems.push(`console: ${text.slice(0, 200)}`);
  }
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${String(err).split('\n')[0].slice(0, 160)}`);
    problems.push(`${name}: ${String(err).split('\n')[0]}`);
    await shot(page, `fail-${name.replace(/\W+/g, '-')}`);
  }
}

await step('login page renders', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Ledger Console' }).waitFor({ timeout: 5000 });
  await shot(page, '01-login');
});

await step('sign in as alice', async () => {
  await page.getByLabel('Email').fill('alice@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await shot(page, '02-dashboard');
});

await step('dashboard shows a balance', async () => {
  const text = await page.locator('body').innerText();
  if (!/₹[\d,]+\.\d{2}/.test(text)) throw new Error('no formatted money on dashboard');
  if (!/Balances match the ledger/.test(text)) throw new Error('reconciliation badge missing');
});

await step('accounts page', async () => {
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('heading', { name: 'Accounts' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(900);
  const rows = await page.locator('tbody tr').count();
  if (rows < 3) throw new Error(`expected seeded accounts, saw ${rows} rows`);
  await shot(page, '03-accounts');
});

await step('move money page + transfer', async () => {
  await page.getByRole('link', { name: 'Move money' }).click();
  await page.getByRole('heading', { name: 'Move money' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(900);
  await shot(page, '04-transfer-empty');

  await page.getByLabel('Amount').fill('12.34');
  await page.getByLabel('Reference').fill('Playwright smoke');

  // Pick a destination in the same currency.
  const destination = page.getByRole('combobox').nth(1);
  if (await destination.isDisabled()) throw new Error('destination select opened disabled');
  await destination.click();
  await page.waitForTimeout(400);
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Last result').waitFor({ timeout: 8000 });
  await page.waitForTimeout(1500);

  const panel = await page.locator('body').innerText();
  if (!/COMPLETED/.test(panel)) throw new Error('transfer did not complete');
  if (!/Debits equal credits/.test(panel)) throw new Error('ledger legs not shown');
  await shot(page, '05-transfer-result');
});

await step('same key with a different amount is refused', async () => {
  // The previous step already spent this key on 12.34.
  await page.getByLabel('Amount').fill('7.00');
  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByRole('button', { name: /Use a new idempotency key/ }).waitFor({ timeout: 8000 });
  await shot(page, '11-key-conflict');
});

await step('idempotent replay moves money once', async () => {
  const balanceOf = async () => {
    const label = await page.locator('text=/^Available /').first().innerText();
    return Number(label.replace(/[^0-9.]/g, ''));
  };

  await page.getByRole('button', { name: /Use a new idempotency key/ }).click();
  await page.waitForTimeout(300);

  const before = await balanceOf();
  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Debits equal credits').waitFor({ timeout: 8000 });
  await page.waitForTimeout(1600);
  const afterFirst = await balanceOf();

  // Identical payload, identical key: the API must replay, not move money again.
  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Replayed').waitFor({ timeout: 8000 });
  await page.waitForTimeout(1600);
  const afterSecond = await balanceOf();

  if (Math.abs(before - afterFirst - 7) > 0.001) throw new Error(`first send moved ${before - afterFirst}`);
  if (Math.abs(afterFirst - afterSecond) > 0.001) throw new Error('replay moved money a second time');
  await shot(page, '12-idempotent-replay');
});

await step('transactions page + detail sheet', async () => {
  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.getByRole('heading', { name: 'Transactions' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1000);
  await shot(page, '06-transactions');

  await page.locator('tbody tr').first().click();
  await page.getByText('Ledger entries').waitFor({ timeout: 5000 });
  await page.waitForTimeout(700);
  await shot(page, '07-transaction-detail');
  await page.keyboard.press('Escape');
});

await step('ledger page', async () => {
  await page.getByRole('link', { name: 'Ledger' }).click();
  await page.getByRole('heading', { name: 'Ledger' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  const text = await page.locator('body').innerText();
  if (!/Matches/.test(text)) throw new Error('reconciliation stat missing');
  if ((await page.locator('tbody tr').count()) === 0) throw new Error('no journal entries');
  await shot(page, '08-ledger');
});

await step('admin link hidden for a normal user', async () => {
  if ((await page.getByRole('link', { name: 'Admin' }).count()) !== 0) {
    throw new Error('Admin nav visible to a non-admin');
  }
});

await step('sign in as admin and verify the books', async () => {
  await page.locator('aside button').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.getByRole('heading', { name: 'Ledger Console' }).waitFor({ timeout: 6000 });

  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 8000 });

  await page.getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('heading', { name: 'Admin' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  const text = await page.locator('body').innerText();
  if (!/Books balance/.test(text)) throw new Error('double-entry verification did not report balanced');
  await shot(page, '09-admin');
});

await step('mobile layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) throw new Error(`horizontal overflow of ${overflow}px`);
  await shot(page, '10-mobile');
});

await browser.close();

console.log(`\nscreenshots → ${OUT}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
console.log('\nall UI checks passed');
