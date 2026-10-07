/**
 * Retakes the /curriculum/howto screenshots (owner, 2026-10-07) by driving the
 * live GC 1010 capture pages in headless Chromium.
 *
 * SAFETY: every non-GET /api request is answered inside the browser and never
 * reaches the server (conversation saves, reading files, chat turns, profile
 * generation, the stress test, approval). The interview and the generated
 * profile are replayed from real data:
 *   DATA/turns.json   — json_agg of 3 capture_messages rows {turn, role, content}
 *                       (an opening assistant turn, a user reply, the next turn)
 *   DATA/profile.json — the course's course_capture_profiles.profile
 * Verify afterwards that the course's profile updated_at and snapshot count are
 * unchanged.
 *
 * Needs playwright-core (not a repo dependency) and a Playwright Chromium:
 *   mkdir /tmp/pw && cd /tmp/pw && npm i playwright-core@1.58
 *   NODE_PATH=/tmp/pw/node_modules node scripts/howto/screenshots.cjs <slug> [stop] 
 * Env: HOWTO_DATA (default ./howto-data), HOWTO_OUT (default public/howto).
 * Faculty login is read from FACULTY_BASIC_AUTH via ~/.claude/dashboard/read-env.mjs.
 */
const path = require('path');
const fs = require('fs');
const DATA = process.env.HOWTO_DATA || 'howto-data';
const OUT = process.env.HOWTO_OUT || 'public/howto';
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const APP = '/Users/admin/projects/curriculum_developer';
const env = k => execFileSync('node', [process.env.HOME + '/.claude/dashboard/read-env.mjs', APP, k]).toString().trim();
const ORIGIN = 'https://gcworkflow.clemson.edu:8443';

async function open() {
  const [username, ...rest] = env('FACULTY_BASIC_AUTH').split(':');
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  });
  const context = await browser.newContext({
    httpCredentials: { username, password: rest.join(':') },
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const blocked = [];
  // SAFETY: no write ever reaches the server. Any non-GET to /api is answered
  // here unless a step installs a more specific mock first.
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.continue();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return { browser, page, blocked, ORIGIN };
}
async function buttons(page) {
  return page.$$eval('button, a', els => els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 60));
}

const STOP = process.argv[3] || 'end';
(async () => {
  const { browser, page, blocked, ORIGIN } = await open();
  const slug = process.argv[2];
  const shot = async (name, locator) => {
    const opts = { path: path.join(OUT, `${name}.png`), animations: 'disabled' };
    if (locator) await locator.screenshot(opts); else await page.screenshot(opts);
    console.log('shot', name);
  };

  // 01 course list — GC 1010's row
  await page.goto(`${ORIGIN}/courses?slug=${slug}`, { waitUntil: 'networkidle' });
  const row = page.locator('a, li, div').filter({ hasText: /^GC 1010\s*Orientation/ }).last();
  await row.scrollIntoViewIfNeeded();
  await shot('01-course-list', row);

  // 02 materials
  await page.goto(`${ORIGIN}/capture/GC%201010?slug=${slug}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '← Back to the interview' }).first().click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('02-materials');

  // 03 triage
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('03-triage');
  if (STOP === 'triage') { console.log(await buttons(page)); return browser.close(); }

  // 04 interview start
  await page.getByRole('button', { name: /continue to interview|read files/i }).first().click();
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('04-interview-start');

  // Replay real turns from the 2026-10-07 morning session (no AI call, no write).
  const turns = JSON.parse(fs.readFileSync(path.join(DATA, 'turns.json'), 'utf8'));
  const assistant = turns.filter(t => t.role === 'assistant').map(t => JSON.parse(t.content));
  const userReply = turns.find(t => t.role === 'user').content;
  let chatCall = 0;
  await page.route('**/api/capture/*/chat**', async route => {
    const r = assistant[Math.min(chatCall++, assistant.length - 1)];
    const body = [JSON.stringify({ kind: 'session', sessionId: '00000000-0000-4000-8000-000000000001' }), JSON.stringify({ kind: 'final', response: r })].join('\n') + '\n';
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
  });
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await page.waitForTimeout(2000);
  await page.locator('#capture-reply').fill(userReply);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(2500);
  const panel = page.locator('section').filter({ hasText: 'Interview conversation' }).first();
  await panel.scrollIntoViewIfNeeded();
  await shot('05-interview', panel);
  if (STOP === 'interview') { console.log(await buttons(page)); return browser.close(); }

  // 06 finish: one last question, then Generate Profile
  await page.getByRole('button', { name: /give me one last question/i }).click();
  await page.waitForTimeout(2500);
  const finish = page.locator('section').filter({ hasText: 'Interview conversation' }).first().locator('div.border-t').last();
  await finish.scrollIntoViewIfNeeded();
  await shot('06-generate-button', finish);

  // 07 generating (held response), then the real current draft as the "result"
  const profile = JSON.parse(fs.readFileSync(path.join(DATA, 'profile.json'), 'utf8'));
  let release;
  const held = new Promise(r => { release = r; });
  await page.route('**/api/capture/*/scores**', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile, reviewerStatus: 'ai_drafted', telemetry: null, materialsHealth: null }) });
  });
  await page.getByRole('button', { name: /generate profile/i }).click();
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('07-generating');
  release();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('08-outcomes-check');
  if (STOP === 'reconcile') { console.log(await buttons(page)); return browser.close(); }

  // 09 review
  await page.getByRole('button', { name: /looks good — proceed/i }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /looks good — continue to review/i }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('09-review');
  // 10 a card opened with "Needs adjusting" — pin the card element before clicking
  const adjustBtn = await page.getByRole('button', { name: 'Needs adjusting' }).first().elementHandle();
  const cardEl = await adjustBtn.evaluateHandle(b => {
    let n = b.parentElement;
    while (n && !(n.textContent.includes('#') && n.querySelector('textarea, input') && n.getBoundingClientRect().height > 200)) n = n.parentElement;
    return n || b.parentElement;
  });
  await adjustBtn.click();
  await page.waitForTimeout(1000);
  await cardEl.asElement().scrollIntoViewIfNeeded();
  const hideBar = await page.addStyleTag({ content: '[data-testid="action-bar"]{visibility:hidden!important}' });
  await cardEl.asElement().screenshot({ path: path.join(OUT, '10-needs-adjusting.png'), animations: 'disabled' });
  console.log('shot 10-needs-adjusting');
  console.log('ADJUST:', (await cardEl.asElement().$$eval('button', bs => bs.map(b => b.textContent.trim()))));
  await hideBar.evaluate(n => n.remove());
  if (STOP === 'adjust') return browser.close();
  await cardEl.asElement().$('button:has-text("Cancel")').then(b => b && b.click());
  await page.waitForTimeout(500);

  // Confirm every remaining card so approval unlocks.
  for (let i = 0; i < 12; i++) {
    const btn = page.getByRole('button', { name: '✓ Looks right' }).first();
    if (!(await btn.count())) break;
    const before = await page.getByRole('button', { name: '✓ Looks right' }).count();
    await btn.click(); await page.waitForTimeout(300);
    if ((await page.getByRole('button', { name: '✓ Looks right' }).count()) >= before) break;
  }
  const bar = page.getByTestId('action-bar');
  await bar.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForTimeout(1200);
  const dialog = page.locator('div.shadow-md').filter({ hasText: 'Caption (optional)' }).first();
  await shot('11-approve', dialog);
  await dialog.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForTimeout(1500);
  const done = page.locator('div').filter({ hasText: /is now part of the program record/ }).last();
  const captured = done.locator('xpath=ancestor-or-self::*[contains(@class,"border-green-600")][1]');
  await captured.scrollIntoViewIfNeeded();
  await shot('12-captured', captured);

  console.log('BLOCKED:', blocked);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
