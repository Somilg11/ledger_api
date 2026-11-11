/**
 * UI smoke test for the Ledger.
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
  await page.getByRole('heading', { name: 'Ledger' }).waitFor({ timeout: 5000 });
  await shot(page, '01-login');
});

await step('demo guide explains real scenarios and dependency status', async () => {
  await page.getByRole('link', { name: 'View demo guide and credentials' }).click();
  await page.getByRole('heading', { name: 'Follow the money. Verify every entry.' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'API, MongoDB, and Redis are ready' }).waitFor();
  await page.getByRole('heading', { name: '3. Reserve before settlement' }).waitFor();
  await page.getByRole('group', { name: 'Demo credentials' }).waitFor();
  if (!(await page.locator('body').innerText()).includes(PASSWORD))
    throw new Error('demo password is missing');
  await shot(page, '00-demo-guide');
  await page.getByRole('link', { name: 'Back to sign in' }).click();
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

await step('collapsed sidebar icons stay centered and the choice survives reload', async () => {
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.locator('aside[data-collapsed="true"]').waitFor();
  await page.waitForTimeout(250);
  const misaligned = await page.locator('aside nav a').evaluateAll((links) =>
    links
      .filter((link) => {
        const icon = link.querySelector('svg');
        const row = link.getBoundingClientRect();
        const box = icon.getBoundingClientRect();
        return (
          Math.abs(row.x + row.width / 2 - (box.x + box.width / 2)) > 1 ||
          Math.abs(row.y + row.height / 2 - (box.y + box.height / 2)) > 1 ||
          row.width !== 36 ||
          row.height !== 36 ||
          getComputedStyle(link).display !== 'flex'
        );
      })
      .map((link) => link.getAttribute('aria-label'))
  );
  if (misaligned.length) throw new Error(`misaligned collapsed icons: ${misaligned.join(', ')}`);
  await page.getByRole('link', { name: 'Accounts', exact: true }).hover();
  await page.getByRole('tooltip', { name: 'Accounts', exact: true }).waitFor();
  await shot(page, '20-sidebar-collapsed');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.locator('aside[data-collapsed="true"]').waitFor();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
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

const playgroundBalance = async (field = 'posted-balance', card = 0) => {
  const text = await page.getByTestId(`play-account-${card}`).getByTestId(field).innerText();
  return Number(text.replace(/[^0-9.-]/g, ''));
};
const waitForPlayground = async () => {
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Refresh balances'
    );
    return document.querySelector('[data-testid="play-account-0"]') && button && !button.disabled;
  });
};

await step('playground moves real balances and retries once', async () => {
  await page.getByRole('link', { name: 'Playground', exact: true }).click();
  await page.getByRole('heading', { name: 'Playground', exact: true }).waitFor();
  await waitForPlayground();
  await page.getByLabel('Amount (INR)', { exact: true }).fill('1.00');
  const before = await playgroundBalance();
  const destinationBefore = await playgroundBalance('posted-balance', 1);
  await page.getByRole('button', { name: 'Run transfer', exact: true }).click();
  await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
  await waitForPlayground();
  const after = await playgroundBalance();
  if (before - after !== 1 || (await playgroundBalance('posted-balance', 1)) - destinationBefore !== 1)
    throw new Error('playground balances did not move by exactly 1');
  await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
  await page
    .getByRole('region', { name: 'Latest result', exact: true })
    .getByText('Retry result', { exact: true })
    .waitFor();
  await waitForPlayground();
  if ((await playgroundBalance()) !== after) throw new Error('retry moved money twice');
  const logs = await page.getByRole('list', { name: 'API events' }).innerText();
  if (
    !logs.includes('HTTP 201') ||
    !logs.includes('request ') ||
    !logs.includes('DEBIT') ||
    !logs.includes('CREDIT')
  )
    throw new Error('actual request or journal evidence is missing');
});

await step('playground reserves, voids, and captures funds visibly', async () => {
  await page.getByLabel('Operation', { exact: true }).click();
  await page.getByRole('option', { name: 'Hold', exact: true }).click();
  const posted = await playgroundBalance();
  const available = await playgroundBalance('available-balance');
  await page.getByRole('button', { name: 'Run hold', exact: true }).click();
  await page.getByRole('button', { name: 'Void hold', exact: true }).waitFor();
  await waitForPlayground();
  if (
    (await playgroundBalance()) !== posted ||
    available - (await playgroundBalance('available-balance')) !== 1
  )
    throw new Error('hold did not reserve funds without posting');
  if (!(await page.getByTestId('journal-verdict').innerText()).includes('No journal entries'))
    throw new Error('hold wrote journal entries');
  await page.getByRole('button', { name: 'Void hold', exact: true }).click();
  await page.getByTestId('journal-verdict').filter({ hasText: 'released' }).waitFor();
  await waitForPlayground();
  if ((await playgroundBalance('available-balance')) !== available || (await playgroundBalance()) !== posted)
    throw new Error('void did not restore reservation');
  await page.getByRole('button', { name: 'Run hold', exact: true }).click();
  await page.getByRole('button', { name: 'Capture hold', exact: true }).waitFor();
  await waitForPlayground();
  await page.getByRole('button', { name: 'Capture hold', exact: true }).click();
  await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
  await waitForPlayground();
  if (
    posted - (await playgroundBalance()) !== 1 ||
    available - (await playgroundBalance('available-balance')) !== 1
  )
    throw new Error('capture did not settle exactly once');
  // The cached authorization response used to say PENDING even after capture.
  // The playground must show the authoritative stored status on a retry.
  await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
  await page
    .getByRole('region', { name: 'Latest result', exact: true })
    .getByText('Retry result', { exact: true })
    .waitFor();
  await waitForPlayground();
  if (await page.getByRole('button', { name: 'Capture hold', exact: true }).count())
    throw new Error('replayed authorization revived a settled hold');
});

await step('playground rejects overdrafts and fits mobile', async () => {
  const before = await playgroundBalance();
  await page.getByRole('button', { name: 'Try an overdraft', exact: true }).click();
  await page.getByRole('button', { name: 'Run withdraw', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Insufficient/ })
    .waitFor();
  await waitForPlayground();
  if ((await playgroundBalance()) !== before) throw new Error('rejected withdrawal changed the balance');
  await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
  await page.locator('main').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: `${OUT}/18-playground.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) throw new Error(`playground overflow of ${overflow}px`);
  await page.locator('main').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: `${OUT}/19-playground-mobile.png`, fullPage: false });
  await page.getByRole('button', { name: 'Clear timeline', exact: true }).click();
  if ((await playgroundBalance()) !== before) throw new Error('clearing events changed money');
  await page
    .getByText('Waiting for an action. Run a payment or refresh balances.', { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: 'Ledger', exact: true }).click();
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
  await page.getByRole('heading', { name: 'Ledger' }).waitFor({ timeout: 6000 });

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

await step('register, then verify the email from the mock message', async () => {
  const email = `smoke.${Date.now()}@example.com`;

  // The previous step left an admin session open, and /login redirects while
  // one exists, so clear it before registering.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.locator('aside button').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.getByRole('heading', { name: 'Ledger' }).waitFor({ timeout: 8000 });

  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Mail is mocked, so the link the user would have received is in a toast.
  const linkNode = page.locator('[data-sonner-toast] code').first();
  await linkNode.waitFor({ timeout: 10_000 });
  const link = (await linkNode.innerText()).trim();
  if (!/\/verify-email\?token=/.test(link)) throw new Error(`toast did not contain a link: ${link}`);

  // A fresh account is unverified until the link is used.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByText('Your email address is not verified').waitFor({ timeout: 8000 });
  await shot(page, '13-unverified-banner');

  // Opening the link must not verify on its own - a scanner that pre-fetches
  // URLs would otherwise confirm addresses for the recipient.
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Confirm your email address' }).waitFor({ timeout: 8000 });
  await shot(page, '14-mock-email');

  await page.getByRole('button', { name: 'Verify email address' }).click();
  await page.getByRole('heading', { name: 'Email verified' }).waitFor({ timeout: 8000 });
  await shot(page, '15-verified');

  // Single use: the same link cannot verify twice.
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Verify email address' }).click();
  await page.getByText(/invalid or has expired/).waitFor({ timeout: 8000 });

  // And the banner is gone for that user.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if ((await page.getByText('Your email address is not verified').count()) !== 0) {
    throw new Error('the unverified banner is still showing after verification');
  }
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

await step('playground prepares wallets for a new user', async () => {
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Playground', exact: true }).click();
  await page.getByRole('button', { name: 'Create two funded demo wallets', exact: true }).click();
  await waitForPlayground();
  if ((await playgroundBalance()) !== 1000 || (await playgroundBalance('posted-balance', 1)) !== 250)
    throw new Error('new playground wallets were not funded as documented');
  await page.getByRole('button', { name: 'Run transfer', exact: true }).click();
  await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
  await waitForPlayground();
});

await step('demo guide preserves identity and requires manual sign-in', async () => {
  const before = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ledger.session')).user.email);
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: `Signed in as ${before}` }).waitFor();
  const after = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ledger.session')).user.email);
  if (before !== after) throw new Error('guide switched the current user');
  if (await page.getByRole('button', { name: /Explore as/ }).count())
    throw new Error('automatic sign-in shortcut remains');
  await shot(page, '16-mobile-demo');
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.getByRole('heading', { name: 'Ledger', exact: true }).waitFor();

  let loginCalls = 0;
  const observe = (request) => {
    if (request.method() === 'POST' && /\/auth\/(login|logout)$/.test(request.url())) loginCalls += 1;
  };
  page.on('request', observe);
  try {
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Sign in to start' }).waitFor();
    await page.getByRole('link', { name: 'Sign in to open scenario' }).first().click();
    await page.getByRole('heading', { name: 'Ledger', exact: true }).waitFor();
    await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Ledger', exact: true }).waitFor();
    if (loginCalls !== 0) throw new Error('guide triggered an authentication request');
    const session = await page.evaluate(() => sessionStorage.getItem('ledger.session'));
    if (session !== null) throw new Error('guide created an authenticated session');
  } finally {
    page.off('request', observe);
  }
});

await browser.close();

console.log(`\nscreenshots → ${OUT}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
console.log('\nall UI checks passed');
