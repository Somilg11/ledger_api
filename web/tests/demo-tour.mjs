/**
 * Records a narrated end-to-end tour of the console and captures the
 * screenshots the README embeds.
 *
 *   npm run stack:up && npm run seed
 *   npm run demo
 *
 * Produces:
 *   docs/screenshots/*.png   committed, embedded in the README
 *   docs/demo/ledger-demo.mp4 (gitignored - upload it somewhere and link it)
 *
 * Paced deliberately: this is meant to be watched, not to pass quickly.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const SHOTS = path.join(repo, 'docs', 'screenshots');
const VIDEO_DIR = path.join(repo, 'docs', 'demo');
const RAW = path.join(VIDEO_DIR, 'raw');

const PASSWORD = process.env.DEMO_PASSWORD || 'Sup3rStrong!Pass';

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

async function resolveBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  for (const candidate of ['http://localhost:8080', 'http://localhost:5173']) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return candidate;
    } catch {
      /* try the next one */
    }
  }
  console.error('No console found on :8080 or :5173. Run `npm run stack:up` first.');
  process.exit(1);
}

const BASE = await resolveBaseUrl();

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }
);

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  recordVideo: { dir: RAW, size: { width: 1440, height: 900 } },
});

const page = await context.newPage();

/** Set while placing the hold, used again on the statement page. */
let holdAccountNumber = '';

/** Long enough for a viewer to read the screen before it changes. */
const beat = (ms = 1400) => page.waitForTimeout(ms);

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`  shot: ${name}`);
}

let failure = null;

async function scene(title, fn) {
  if (failure) return; // a scene already failed; stop but still save the video
  console.log(`\n▸ ${title}`);
  try {
    await fn();
  } catch (err) {
    failure = { title, err };
    console.error(`  failed: ${String(err).split('\n')[0]}`);
  }
}

// ── 1. Sign in ──────────────────────────────────────────────────────────────
await scene('Sign in', async () => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await beat(1200);
  await shot('01-login');

  await page.getByLabel('Email').pressSequentially('alice@example.com', { delay: 35 });
  await page.getByLabel('Password').pressSequentially(PASSWORD, { delay: 25 });
  await beat(600);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 10_000 });
  await beat(2200);
  await shot('02-dashboard');
});

// ── 2. Accounts and reconciliation ──────────────────────────────────────────
await scene('Accounts', async () => {
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('heading', { name: 'Accounts' }).waitFor();
  await beat(2400);
  await shot('03-accounts');
});

// ── 3. A transfer, and the ledger entries it writes ─────────────────────────
await scene('Transfer', async () => {
  await page.getByRole('link', { name: 'Move money' }).click();
  await page.getByRole('heading', { name: 'Move money' }).waitFor();
  await beat(1400);

  await page.getByRole('combobox').nth(1).click();
  await beat(700);
  await page.locator('[role="option"]').first().click();
  await beat(500);

  await page.getByLabel('Amount').pressSequentially('250.00', { delay: 70 });
  await page.getByLabel('Reference').pressSequentially('Rent share', { delay: 45 });
  await beat(1200);
  await shot('04-transfer-form');

  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Debits equal credits').waitFor({ timeout: 10_000 });
  await beat(2600);
  await shot('05-transfer-result');
});

// ── 4. Idempotent replay ────────────────────────────────────────────────────
await scene('Idempotent replay', async () => {
  // Same form, same key, submitted again: the money must move only once.
  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Replayed').waitFor({ timeout: 10_000 });
  await beat(3000);
  await shot('06-idempotent-replay');
});

// ── 5. A hold, then capture ─────────────────────────────────────────────────
await scene('Hold, then capture', async () => {
  await page.getByRole('tab', { name: 'Hold' }).click();
  await beat(1000);

  await page.getByRole('combobox').nth(1).click();
  await beat(700);
  await page.locator('[role="option"]').first().click();
  await beat(400);

  // The statement page defaults to a different account, so remember which one
  // the hold is placed from and select it explicitly later.
  holdAccountNumber = (await page.getByRole('combobox').first().innerText()).match(/\d{16}/)?.[0] ?? '';

  await page.getByLabel('Amount').pressSequentially('80.00', { delay: 70 });
  await page.getByLabel('Reference').pressSequentially('Card authorisation', { delay: 40 });
  await beat(1000);
  await page.getByRole('button', { name: /Place hold/ }).click();
  await page.getByText('PENDING').first().waitFor({ timeout: 10_000 });
  await beat(2600);
  await shot('07-hold-placed');

  // The reservation shows up as a gap between available and settled balance.
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('heading', { name: 'Accounts' }).waitFor();
  await beat(2800);
  await shot('08-hold-reserved-balance');

  // Settle it from the statement.
  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.getByRole('heading', { name: 'Transactions' }).waitFor();
  await beat(1200);

  if (holdAccountNumber) {
    await page.getByRole('combobox').first().click();
    await beat(700);
    await page.locator('[role="option"]', { hasText: holdAccountNumber }).first().click();
    await beat(1600);
  }

  // Target the pending row rather than whichever row happens to be first.
  await page.locator('tbody tr', { hasText: 'PENDING' }).first().click();
  await page.getByText('This is a hold').waitFor({ timeout: 8000 });
  await beat(2600);
  await shot('09-hold-detail');

  await page.getByRole('button', { name: 'Capture' }).click();
  await beat(2800);
  await shot('10-hold-captured');
  await page.keyboard.press('Escape');
  await beat(800);
});

// ── 6. The journal ──────────────────────────────────────────────────────────
await scene('Ledger', async () => {
  await page.getByRole('link', { name: 'Ledger' }).click();
  await page.getByRole('heading', { name: 'Ledger' }).waitFor();
  await beat(3000);
  await shot('11-ledger');
});

// ── 7. Admin: verification, reversal, audit trail ───────────────────────────
await scene('Admin', async () => {
  await page.locator('aside button').first().click();
  await beat(700);
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.getByRole('heading', { name: 'Ledger Console' }).waitFor({ timeout: 10_000 });
  await beat(900);

  await page.getByLabel('Email').pressSequentially('admin@example.com', { delay: 35 });
  await page.getByLabel('Password').pressSequentially(PASSWORD, { delay: 25 });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 10_000 });
  await beat(1400);

  await page.getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('heading', { name: 'Admin' }).waitFor();
  await beat(3200);
  await shot('12-admin-verify');
});

// ── 8. Email verification, with mail mocked ─────────────────────────────────
await scene('Email verification', async () => {
  const email = `demo.${Date.now()}@example.com`;

  await page.locator('aside button').first().click();
  await beat(600);
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.getByRole('heading', { name: 'Ledger Console' }).waitFor({ timeout: 10_000 });

  await page.getByRole('tab', { name: 'Create account' }).click();
  await beat(700);
  await page.getByLabel('Email').pressSequentially(email, { delay: 30 });
  await page.getByLabel('Password').pressSequentially(PASSWORD, { delay: 25 });
  await beat(600);
  await page.getByRole('button', { name: 'Create account' }).click();

  const linkNode = page.locator('[data-sonner-toast] code').first();
  await linkNode.waitFor({ timeout: 10_000 });
  await beat(3200);
  await shot('13-verification-toast');

  const link = (await linkNode.innerText()).trim();

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByText('Your email address is not verified').waitFor({ timeout: 10_000 });
  await beat(2400);
  await shot('14-unverified-banner');

  await page.goto(link, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Confirm your email address' }).waitFor({ timeout: 10_000 });
  await beat(3000);
  await shot('15-mock-email');

  await page.getByRole('button', { name: 'Verify email address' }).click();
  await page.getByRole('heading', { name: 'Email verified' }).waitFor({ timeout: 10_000 });
  await beat(2800);
  await shot('16-verified');
});

// ── 9. Mobile ───────────────────────────────────────────────────────────────
await scene('Mobile layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await beat(2600);
  await page.screenshot({ path: path.join(SHOTS, '17-mobile.png') });
  await beat(600);
});

await context.close();
await browser.close();

if (failure) {
  console.error(`\nTour stopped during "${failure.title}". Encoding what was captured anyway.`);
}

// ── Encode ──────────────────────────────────────────────────────────────────
const raw = fs.readdirSync(RAW).filter((f) => f.endsWith('.webm'));
if (raw.length === 0) {
  console.error('\nNo video was recorded.');
  process.exit(1);
}

const source = path.join(RAW, raw[0]);
const target = path.join(VIDEO_DIR, 'ledger-demo.mp4');

console.log('\nEncoding to MP4…');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i', source,
    // H.264 + yuv420p is the combination that plays everywhere, including
    // Google Drive's preview and QuickTime.
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    '-preset', 'slow',
    // Even dimensions are required by yuv420p.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-movflags', '+faststart',
    target,
  ],
  { stdio: 'ignore' }
);

fs.rmSync(RAW, { recursive: true, force: true });

const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`\nVideo:       ${target}  (${mb} MB)`);
console.log(`Screenshots: ${SHOTS}`);

if (failure) process.exit(1);
