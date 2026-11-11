/**
 * Records the current Ledger UI with burned-in captions, then safely replaces
 * docs/demo/ledger-demo.mp4 only after every scene and encoding check succeeds.
 *
 * Prerequisites: npm run demo:up, installed Chrome, and ffmpeg/ffprobe on PATH.
 * Run: npm run demo
 * This exercises real simulated payments and preserves the existing database.
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const videoDir = path.join(repo, 'docs', 'demo');
const rawDir = path.join(videoDir, 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const runDir = fs.mkdtempSync(path.join(rawDir, 'tour-'));
const PASSWORD = process.env.DEMO_PASSWORD || 'Sup3rStrong!Pass';
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }
);
const openContexts = new Set();
let page;
let transferId;
let recordingPath;

async function recordingContext() {
  const viewport = { width: 1440, height: 900 };
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: runDir, size: viewport },
  });
  openContexts.add(context);
  await context.addInitScript(() => {
    window.__caption = (text) => {
      let overlay = document.getElementById('__ledger_caption');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = '__ledger_caption';
        Object.assign(overlay.style, {
          position: 'fixed',
          left: '50%',
          bottom: '18px',
          transform: 'translateX(-50%)',
          width: 'max-content',
          maxWidth: 'min(820px, 88vw)',
          padding: '11px 18px',
          borderRadius: '10px',
          background: 'rgba(15, 14, 21, .96)',
          border: '1px solid #8b80f94a',
          boxShadow: '0 6px 24px #0006',
          color: '#f1effa',
          font: '500 15px/1.45 Geist, system-ui, sans-serif',
          textAlign: 'center',
          textWrap: 'balance',
          zIndex: '2147483647',
          pointerEvents: 'none',
        });
        document.body.appendChild(overlay);
      }
      overlay.textContent = text || '';
      overlay.style.display = text ? 'block' : 'none';
    };
  });
  const next = await context.newPage();
  next.setDefaultTimeout(12_000);
  return { context, page: next };
}
const pause = (ms = 1000) => page.waitForTimeout(ms);
async function caption(text, ms = 3000) {
  await page.evaluate((value) => window.__caption(value), text);
  if (ms) await pause(ms);
}
async function scene(title, work) {
  console.log(`SCENE ${title}`);
  await caption(null, 0).catch(() => {});
  await work();
  console.log(`PASS ${title}`);
}
async function login(email) {
  await page.getByLabel('Email', { exact: true }).pressSequentially(email, { delay: 28 });
  await page.getByLabel('Password', { exact: true }).pressSequentially(PASSWORD, { delay: 24 });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
}
async function chooseOperation(name) {
  await page.getByLabel('Operation', { exact: true }).click();
  await pause(500);
  await page.getByRole('option', { name, exact: true }).click();
}
async function ready() {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent.trim() === 'Refresh balances' && !button.disabled
    )
  );
}
async function balance(field = 'posted-balance') {
  const text = await page.getByTestId('play-account-0').getByTestId(field).innerText();
  return Number(text.replace(/[^\d.-]/g, ''));
}
async function currentTransaction() {
  return page
    .getByRole('region', { name: 'Latest result', exact: true })
    .locator('button[title]')
    .getAttribute('title');
}
async function finishClip(context) {
  await caption(null, 0);
  await pause(500);
  const video = page.video();
  await context.close();
  openContexts.delete(context);
  recordingPath = await video.path();
}

try {
  const desktop = await recordingContext();
  page = desktop.page;
  await scene('Public guide and manual sign-in', async () => {
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Follow the money. Verify every entry.' }).waitFor();
    await caption('Ledger: a double-entry banking simulation. All money here is simulated.', 3600);
    await caption('The public guide lists demo credentials. Opening it never signs you in.', 3600);
    await page.getByRole('link', { name: 'Sign in with demo credentials', exact: true }).click();
    await pause(600);
    await login('alice@example.com');
    await caption('Alice signs in through the normal authentication flow.', 2500);
    await caption('Balances stay separate by currency, with journal reconciliation alongside.', 3300);
  });
  await scene('Accounts and reconciliation', async () => {
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
    await pause(700);
    await caption('Posted balance, available funds, and reconciliation explain each account.', 3500);
  });
  await scene('Data-flow playground and sidebar', async () => {
    await page.getByRole('link', { name: 'Playground', exact: true }).click();
    await page.getByTestId('play-account-0').waitFor();
    await ready();
    await caption('Accounts connect to the posting engine and its confirmed journal.', 3600);
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.getByRole('link', { name: 'Accounts', exact: true }).hover();
    await pause(900);
    await page.mouse.move(700, 80);
    await caption('Collapse navigation to give the diagram more room. Icons retain tooltips.', 3000);
  });
  await scene('Transfer and matching journal entries', async () => {
    assert.ok(
      (await balance('available-balance')) > 25,
      'Alice needs at least ₹25 available for the recording'
    );
    await page.getByLabel('Amount (INR)', { exact: true }).fill('25.00');
    const before = await balance();
    await caption('Transfer ₹25. Both account updates and journal legs must commit together.', 3400);
    await caption(null, 0);
    await page.getByRole('button', { name: 'Run transfer', exact: true }).click();
    await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
    await ready();
    assert.equal(before - (await balance()), 25);
    transferId = await currentTransaction();
    assert.ok(transferId);
    await caption('The debit, credit, and two balanced journal entries are confirmed by the API.', 3900);
    await page.getByRole('tab', { name: 'Journal', exact: true }).click();
    await caption('Inspect the posted pair, including each resulting balance.', 3400);
    await page.getByRole('tab', { name: /Activity/ }).click();
    await caption('Activity shows actual API requests, response codes, and request IDs.', 3400);
  });
  await scene('Safe retry', async () => {
    const before = await balance();
    await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
    await page
      .getByRole('region', { name: 'Latest result', exact: true })
      .getByText('Retry result', { exact: true })
      .waitFor();
    await ready();
    assert.equal(await balance(), before);
    assert.equal(await currentTransaction(), transferId);
    await caption('Same key. Same transaction. Retrying did not move the money twice.', 4200);
  });
  await scene('Reserve, then capture', async () => {
    await chooseOperation('Hold');
    await page.getByLabel('Amount (INR)', { exact: true }).fill('10.00');
    const posted = await balance();
    const available = await balance('available-balance');
    await page.getByRole('button', { name: 'Run hold', exact: true }).click();
    await page.getByRole('button', { name: 'Capture hold', exact: true }).waitFor();
    await ready();
    assert.equal(await balance(), posted);
    assert.equal(available - (await balance('available-balance')), 10);
    await caption('A ₹10 hold reduces available funds. Posted balance and journal stay unchanged.', 4200);
    await caption(null, 0);
    await page.getByRole('button', { name: 'Capture hold', exact: true }).click();
    await page.getByTestId('journal-verdict').filter({ hasText: 'Debits equal credits' }).waitFor();
    await ready();
    assert.equal(posted - (await balance()), 10);
    await caption('Capture settles the reservation. Only now does the journal record the payment.', 4200);
  });
  await scene('Void a reservation', async () => {
    await page.getByLabel('Amount (INR)', { exact: true }).fill('5.00');
    const available = await balance('available-balance');
    await page.getByRole('button', { name: 'Run hold', exact: true }).click();
    await page.getByRole('button', { name: 'Void hold', exact: true }).waitFor();
    await ready();
    await pause(800);
    await page.getByRole('button', { name: 'Void hold', exact: true }).click();
    await page.getByTestId('journal-verdict').filter({ hasText: 'released' }).waitFor();
    await ready();
    assert.equal(await balance('available-balance'), available);
    await caption('Void restores the reservation without posting money or creating journal entries.', 3800);
  });
  await scene('Rejected overdraft', async () => {
    const before = await balance();
    await page.getByRole('button', { name: 'Try an overdraft', exact: true }).click();
    await page.getByRole('button', { name: 'Run withdraw', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: /Insufficient/ })
      .waitFor();
    await ready();
    assert.equal(await balance(), before);
    await caption('An overdraft is rejected. The balance stays unchanged; the failure is visible.', 4200);
  });
  await scene('Administrator reconciliation and reversal', async () => {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
    await page.getByRole('heading', { name: 'Ledger', exact: true }).waitFor();
    await login('admin@example.com');
    await page.getByRole('link', { name: 'Admin', exact: true }).click();
    await page.getByText('Books balance', { exact: true }).waitFor();
    await caption('Admin can reconcile the books. Ordinary users cannot access this screen.', 3400);
    await caption(null, 0);
    await page.getByLabel('Transaction id', { exact: true }).fill(transferId);
    await page.getByRole('button', { name: 'Look up', exact: true }).click();
    await page.getByRole('button', { name: 'Reverse transaction', exact: true }).waitFor();
    await page.getByLabel('Reason', { exact: true }).fill('Recorded demo: compensating reversal');
    await caption('A correction is a new opposite payment. The original journal remains.', 3600);
    await caption(null, 0);
    await page.getByRole('button', { name: 'Reverse transaction', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reverse', exact: true }).click();
    await page.getByRole('button', { name: 'Cannot reverse a REVERSED transaction', exact: true }).waitFor();
    await caption('The original is marked REVERSED. A second reversal is refused.', 3300);
    await caption(null, 0);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('“Recorded demo: compensating reversal”', { exact: true }).waitFor();
    await caption('The administrative audit trail records the actor, target, and reason.', 3500);
    await page.getByRole('button', { name: 'Re-run', exact: true }).click();
    await page.getByText('Books balance', { exact: true }).waitFor();
    await caption('Reconciliation still balances after the compensating transaction.', 3500);
  });
  await finishClip(desktop.context);
} finally {
  await Promise.allSettled([...openContexts].map((context) => context.close()));
  await browser.close();
}

console.log('Encoding the verified desktop walkthrough…');
const candidate = path.join(runDir, 'ledger-demo.mp4');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    recordingPath,
    '-vf',
    'fps=24,scale=1440:900,setsar=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '25',
    '-preset',
    'medium',
    '-movflags',
    '+faststart',
    candidate,
  ],
  { stdio: 'ignore' }
);

const probe = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', candidate], {
    encoding: 'utf8',
  })
);
const stream = probe.streams.find((entry) => entry.codec_type === 'video');
assert.equal(stream.codec_name, 'h264');
assert.equal(stream.width, 1440);
assert.equal(stream.height, 900);
assert.ok(Number(probe.format.duration) > 60);
const target = path.join(videoDir, 'ledger-demo.mp4');
fs.renameSync(candidate, target);
fs.rmSync(runDir, { recursive: true, force: true });
console.log(`VIDEO ${target}`);
console.log(
  `VERIFIED ${Number(probe.format.duration).toFixed(1)} seconds, H.264 1440×900, ${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB`
);
