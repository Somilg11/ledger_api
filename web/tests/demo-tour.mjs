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

/**
 * Captions are burned into the recording rather than shipped as a subtitle
 * track: the video is embedded in a README, and GitHub's player has no
 * subtitle controls. Injected as a DOM overlay so it is styled to match the
 * console and timed exactly, instead of reconstructed from timestamps in
 * ffmpeg afterwards.
 *
 * addInitScript re-registers it on every document, so it survives navigation.
 */
await context.addInitScript(() => {
  const ID = '__demo_caption';

  window.__caption = (text) => {
    const paint = () => {
      let el = document.getElementById(ID);
      if (!el) {
        el = document.createElement('div');
        el.id = ID;
        Object.assign(el.style, {
          position: 'fixed',
          left: '50%',
          bottom: '40px',
          transform: 'translateX(-50%)',
          maxWidth: 'min(900px, 86vw)',
          padding: '12px 22px',
          borderRadius: '10px',
          background: 'rgba(10, 11, 13, 0.92)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
          color: '#f7f8f8',
          font: "500 17px/1.45 Inter, ui-sans-serif, system-ui, sans-serif",
          letterSpacing: '-0.01em',
          textAlign: 'center',
          textWrap: 'balance',
          zIndex: '2147483647',
          pointerEvents: 'none',
          opacity: '0',
          transition: 'opacity 260ms ease',
        });
        document.body.appendChild(el);
      }
      el.textContent = text ?? '';
      el.style.opacity = text ? '1' : '0';
    };

    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint, { once: true });
  };
});

const page = await context.newPage();

/** Shows a caption, and gives the viewer time to read it. */
async function caption(text, holdMs = 0) {
  await page.evaluate((t) => window.__caption?.(t), text).catch(() => {});
  if (holdMs) await page.waitForTimeout(holdMs);
}

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
  await beat(800);
  await shot('01-login');

  await caption('A double-entry banking ledger — every rupee that moves is recorded twice.', 3200);
  await caption('Signing in as Alice, one of the seeded demo users.', 1200);

  await page.getByLabel('Email').pressSequentially('alice@example.com', { delay: 35 });
  await page.getByLabel('Password').pressSequentially(PASSWORD, { delay: 25 });
  await beat(600);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 10_000 });
  await beat(900);
  await caption('Balances per currency, and a live check that they match the ledger.', 3600);
  await shot('02-dashboard');
});

// ── 2. Accounts and reconciliation ──────────────────────────────────────────
await scene('Accounts', async () => {
  await caption(null);
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('heading', { name: 'Accounts' }).waitFor();
  await beat(800);
  await caption('Every account shows Available, Balance, and whether it reconciles.', 3400);
  await caption('"Reconciled" means the stored balance equals the sum of its journal entries.', 3600);
  await shot('03-accounts');
});

// ── 3. A transfer, and the ledger entries it writes ─────────────────────────
await scene('Transfer', async () => {
  await caption(null);
  await page.getByRole('link', { name: 'Move money' }).click();
  await page.getByRole('heading', { name: 'Move money' }).waitFor();
  await beat(700);
  await caption('Sending ₹250 between two accounts.', 2200);

  await page.getByRole('combobox').nth(1).click();
  await beat(700);
  await page.locator('[role="option"]').first().click();
  await beat(500);

  await page.getByLabel('Amount').pressSequentially('250.00', { delay: 70 });
  await page.getByLabel('Reference').pressSequentially('Rent share', { delay: 45 });
  await beat(700);
  await caption('Note "sent as 25,000 minor units" — money is integer paise, never a float.', 4000);
  await shot('04-transfer-form');

  await caption(null);
  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Debits equal credits').waitFor({ timeout: 10_000 });
  await beat(900);
  await caption('One transaction produced two ledger entries: a debit and a matching credit.', 4200);
  await caption('All five writes committed inside a single database transaction.', 3600);
  await shot('05-transfer-result');
});

// ── 4. Idempotent replay ────────────────────────────────────────────────────
await scene('Idempotent replay', async () => {
  await caption('Now the same form is submitted again, with the same idempotency key.', 4000);

  // Same form, same key, submitted again: the money must move only once.
  await page.getByRole('button', { name: /Send transfer/ }).click();
  await page.getByText('Replayed').waitFor({ timeout: 10_000 });
  await beat(900);
  await caption('Replayed — the original transaction came back. The money moved once.', 4200);
  await caption('This is what makes retrying a dropped payment request safe.', 3800);
  await shot('06-idempotent-replay');
});

// ── 5. A hold, then capture ─────────────────────────────────────────────────
await scene('Hold, then capture', async () => {
  await caption('A hold is what a card machine does: reserve funds without moving them.', 4200);
  await page.getByRole('tab', { name: 'Hold' }).click();
  await beat(800);

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
  await caption(null);
  await page.getByRole('button', { name: /Place hold/ }).click();
  await page.getByText('PENDING').first().waitFor({ timeout: 10_000 });
  await beat(900);
  await caption('PENDING — and no ledger entries, because nothing has actually moved.', 4200);
  await shot('07-hold-placed');

  // The reservation shows up as a gap between available and settled balance.
  await caption(null);
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('heading', { name: 'Accounts' }).waitFor();
  await beat(800);
  await caption('Available dropped by ₹80. Balance did not — the gap is the reservation.', 4400);
  await caption('The account still reconciles, because a hold never touches the journal.', 4200);
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
  await caption('Holds are settled — or released — from the statement.', 2600);
  await page.locator('tbody tr', { hasText: 'PENDING' }).first().click();
  await page.getByText('This is a hold').waitFor({ timeout: 8000 });
  await beat(800);
  await caption('Capture settles it. Void would return the reservation instead.', 3800);
  await shot('09-hold-detail');

  await caption(null);
  await page.getByRole('button', { name: 'Capture' }).click();
  await beat(1400);
  await caption('Captured. Only now are the debit and credit written to the ledger.', 4200);
  await shot('10-hold-captured');
  await page.keyboard.press('Escape');
  await beat(800);
});

// ── 6. The journal ──────────────────────────────────────────────────────────
await scene('Ledger', async () => {
  await caption(null);
  await page.getByRole('link', { name: 'Ledger' }).click();
  await page.getByRole('heading', { name: 'Ledger' }).waitFor();
  await beat(800);
  await caption('The journal: every debit and credit, with the balance after each one.', 4200);
  await caption('It is append-only — the schema refuses updates and deletes.', 3800);
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

  await caption('Signed in as an administrator, who can see things a user cannot.', 2800);
  await page.getByRole('link', { name: 'Admin' }).click();
  await page.getByRole('heading', { name: 'Admin' }).waitFor();
  await beat(900);
  await caption('Total debits vs total credits, summed across the entire database.', 4200);
  await caption('If these ever disagree, the books are broken — and you know immediately.', 4200);
  await caption('Below: the append-only trail of who reversed or froze what.', 3600);
  await shot('12-admin-verify');
});

// ── 8. Email verification, with mail mocked ─────────────────────────────────
await scene('Email verification', async () => {
  const email = `demo.${Date.now()}@example.com`;

  await page.locator('aside button').first().click();
  await beat(600);
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await page.getByRole('heading', { name: 'Ledger Console' }).waitFor({ timeout: 10_000 });

  await caption('Registering a new account, to show email verification.', 3000);
  await page.getByRole('tab', { name: 'Create account' }).click();
  await beat(700);
  await page.getByLabel('Email').pressSequentially(email, { delay: 30 });
  await page.getByLabel('Password').pressSequentially(PASSWORD, { delay: 25 });
  await beat(600);
  await page.getByRole('button', { name: 'Create account' }).click();

  const linkNode = page.locator('[data-sonner-toast] code').first();
  await linkNode.waitFor({ timeout: 10_000 });
  await beat(900);
  await caption('Mail is mocked — nothing is sent, so the link arrives as a toast instead.', 4400);
  await shot('13-verification-toast');

  const link = (await linkNode.innerText()).trim();

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await caption(null);
  await page.getByText('Your email address is not verified').waitFor({ timeout: 10_000 });
  await beat(800);
  await caption('The account works, but it is tracked as unverified.', 3400);
  await shot('14-unverified-banner');

  await page.goto(link, { waitUntil: 'networkidle' });
  await caption(null);
  await page.getByRole('heading', { name: 'Confirm your email address' }).waitFor({ timeout: 10_000 });
  await beat(800);
  await caption('The link opens a page laid out like the message itself.', 3400);
  await caption('Pressing the button verifies — opening the link does not.', 3600);
  await caption('So a mail scanner that pre-fetches URLs cannot confirm the address for you.', 4400);
  await shot('15-mock-email');

  await page.getByRole('button', { name: 'Verify email address' }).click();
  await caption(null);
  await page.getByRole('heading', { name: 'Email verified' }).waitFor({ timeout: 10_000 });
  await beat(900);
  await caption('Verified. The token is single-use — the same link will not work twice.', 4200);
  await shot('16-verified');
});

// ── 9. Mobile ───────────────────────────────────────────────────────────────
await scene('Mobile layout', async () => {
  await caption(null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await beat(1200);
  await page.screenshot({ path: path.join(SHOTS, '17-mobile.png') });
  await caption('The console works at phone width too.', 3000);
  await caption('Code, API reference and security notes are in the repository.', 3800);
  await caption(null);
  await beat(900);
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
