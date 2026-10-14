/** Optional real localhost smoke, isolated synthetic IndexedDB only.
 * node tests/study-browser-smoke.mjs
 * Set RECALL_BROWSER_EXECUTABLE if Playwright Chromium is not installed.
 * This is a browser check; it does not certify a Windows installer.
 */
import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../scripts/web-server.js';

const server = createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const output = await mkdtemp(path.join(os.tmpdir(), 'recall-study-smoke-'));
let executablePath = process.env.RECALL_BROWSER_EXECUTABLE;
if (!executablePath) {
  try { await access(chromium.executablePath()); }
  catch { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch {} }
}
let browser;
let inspectionPage;
const errors = [], externalRequests = [];
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(origin) && !route.request().url().startsWith('blob:')) { externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  inspectionPage = page;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.recall?.getWorkspace === 'function');
  await page.getByRole('button', { name: 'Statistics / الإحصاءات', exact: true }).waitFor();
  const initial = await page.evaluate(() => window.recall.getWorkspace());
  const workspace = structuredClone(initial.state);
  workspace.courses.push({ id: 'smoke-course', title: 'Synthetic smoke · دراسة', description: 'Synthetic offline validation', color: 'teal' });
  workspace.lectures.push({ id: 'smoke-lecture', courseId: 'smoke-course', title: 'Synthetic lecture · محاضرة', topic: 'Mixed text', notes: '$x^2$ · عربي English', pages: [] });
  workspace.cards.push({ id: 'smoke-card', courseId: 'smoke-course', lectureId: 'smoke-lecture', question: 'Synthetic: what is delayed retrieval?', answer: 'A recall attempt after a known delay.', tags: ['smoke'], source: 'Synthetic fixture', createdAt: '2026-10-01T09:00:00.000Z', schedule: { state: 2, due: '2026-10-13T09:00:00.000Z', last_review: '2026-10-01T09:00:00.000Z', stability: 10, difficulty: 5, elapsed_days: 0, scheduled_days: 10, reps: 3, lapses: 0, learning_steps: 0 } });
  await page.evaluate(payload => window.recall.saveWorkspace(payload), { revision: initial.revision, operationId: crypto.randomUUID(), state: workspace });
  await page.reload();
  const state = () => page.evaluate(async () => (await window.recall.getWorkspace()).state);
  const waitSessions = count => page.waitForFunction(async count => (await window.recall.getWorkspace()).state.studySessions.length === count, count);
  const tracking = () => page.getByRole('button', { name: 'Study tracking / تتبّع الدراسة', exact: true }).click();
  const statistics = () => page.getByRole('button', { name: 'Statistics / الإحصاءات', exact: true }).click();
  await statistics();
  assert.match(await page.locator('.study-statistics').innerText(), /No recorded|No eligible|Not planned|No data|not recorded/i);
  await tracking();
  await page.getByRole('button', { name: 'Lecture plan', exact: true }).click();
  await page.getByLabel('Lecture duration', { exact: true }).fill('60:00');
  await page.getByLabel('Transcription plan', { exact: true }).selectOption('full');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.lecturePlans[0]?.durationSeconds === 3600);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Log viewing', exact: true }).click();
    await page.getByLabel('Session date and time', { exact: true }).fill(`2026-10-${10 + index}T12:00`);
    await page.getByLabel('Source ranges', { exact: true }).fill(`${index * 20}:00–${(index + 1) * 20}:00`);
    if (index === 0) {
      const form = page.locator('form.tracking-editor');
      await form.getByText('Optional details', { exact: true }).click();
      await page.getByLabel('Elapsed effort (minutes)', { exact: true }).fill('45');
      await page.getByLabel('I also transcribed or wrote during this sitting', { exact: true }).check();
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await waitSessions(index + 1);
  }
  let recorded = await state();
  assert.equal(recorded.viewingPasses.length, 1); assert.equal(recorded.viewingPasses[0].status, 'complete'); assert.equal(recorded.viewingPasses[0].completion, 'coverage');
  assert.equal(recorded.studySessions[0].occurredAt, '2026-10-10T09:00:00.000Z');
  await page.getByRole('button', { name: 'Complete viewing today', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await waitSessions(4);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Log viewing', exact: true }).click();
    await page.getByLabel('Viewing pass', { exact: true }).last().selectOption('targeted');
    await page.getByLabel('Source ranges', { exact: true }).fill('05:00–15:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await waitSessions(5 + index);
  }
  recorded = await state();
  assert.equal(recorded.viewingPasses.filter(pass => pass.kind !== 'targeted' && pass.status === 'complete').length, 2);
  assert.equal(recorded.viewingPasses.filter(pass => pass.kind === 'targeted').length, 3);
  // Current written coverage contains verified coverage, and an edit removes old verification.
  for (const [start, end, status] of [['00:00', '15:00', 'verified'], ['15:00', '30:00', 'written']]) {
    await page.getByRole('button', { name: 'Record written progress', exact: true }).click();
    await page.getByLabel('Range start', { exact: true }).fill(start); await page.getByLabel('Range end', { exact: true }).fill(end);
    await page.getByLabel('Current status', { exact: true }).selectOption(status);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: 'Record written progress', exact: true }).waitFor({ state: 'hidden' });
  }
  const progress = page.getByRole('region', { name: 'Manual transcription', exact: true });
  assert.match(await progress.innerText(), /30 min \/ 60 min · 50%/); assert.match(await progress.innerText(), /15 min \/ 60 min · 25%/);
  const ranges = page.getByRole('region', { name: 'Manual writing ranges', exact: true });
  await ranges.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel('Range end', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.transcriptionSegments[0]?.status === 'written');
  recorded = await state(); assert.equal(recorded.transcriptionSegments[0].end, 600); assert.equal(recorded.transcriptionSegments[0].status, 'written');
  await page.reload(); await tracking();
  assert.match(await progress.innerText(), /25 min \/ 60 min/); assert.match(await progress.innerText(), /0 min \/ 60 min · 0%/); assert.match(await progress.innerText(), /10:00–15:00/);
  await statistics();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  assert.match(await page.locator('.study-statistics').innerText(), /45/);
  const derived = await page.evaluate(async () => {
    const { buildStatistics } = await import('/lib/statistics.js');
    return buildStatistics((await window.recall.getWorkspace()).state);
  });
  assert.equal(derived.activity.effortMinutes, 45); assert.equal(derived.activity.sessionCount, 7); assert.equal(derived.activity.activityCounts.transcription, 1);
  for (const tab of ['Overview', 'Activity', 'Recall', 'Evidence', 'Comparisons', 'Schedule']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    assert.ok((await page.locator('.study-statistics').innerText()).length > 50);
  }
  // The original recall editor records a first save once; later reflections do not create attempts.
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Log viewing / سجّل مشاهدة', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Free recall', exact: true }).click();
  await page.getByRole('combobox', { name: 'Recall topic', exact: true }).click();
  await page.getByRole('option', { name: 'Synthetic lecture · محاضرة', exact: true }).click();
  await page.getByLabel('Your explanation from memory', { exact: true }).fill('Synthetic عربي recall: ∂L/∂w = 0.');
  await page.getByRole('button', { name: 'Save recall', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.recallAttempts.length === 1);
  await page.getByLabel('Your explanation from memory', { exact: true }).fill('Later synthetic reflection.');
  await page.getByRole('button', { name: 'Save recall', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.recalls[0]?.body === 'Later synthetic reflection.');
  await page.getByText('Draft saved', { exact: true }).waitFor();
  assert.equal((await state()).recallAttempts.length, 1);
  await page.getByRole('button', { name: 'Assess this attempt / تقييم الاسترجاع', exact: true }).click();
  await page.getByRole('button', { name: 'Add expected idea', exact: true }).click();
  await page.getByLabel('Expected idea', { exact: true }).fill('Synthetic explicit expected idea');
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.recallAttempts[0]?.expectedIdeas.length === 1);
  const attempt = (await state()).recallAttempts[0];
  await page.getByRole('button', { name: 'Assess an idea / application', exact: true }).click();
  await page.getByLabel('Related recall attempt', { exact: true }).selectOption(attempt.id);
  await page.getByLabel('Expected idea', { exact: true }).selectOption(attempt.expectedIdeas[0].id);
  await page.getByLabel('Before-check confidence (0–100, optional)', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Continue to assessment', exact: true }).click();
  await page.getByLabel('Outcome', { exact: true }).selectOption('correct');
  await page.getByLabel('Evidence / scoring notes', { exact: true }).fill('Synthetic explanation checked against the source.');
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.assessments.length === 1);
  const evidence = (await state()).assessments[0]; assert.equal(evidence.confidence, 80); assert.equal(evidence.confidenceTiming, 'before');
  assert.ok(Date.parse(evidence.occurredAt) >= Date.parse(attempt.occurredAt), 'Default capture retains seconds so a later assessment is not backdated before its attempt.');
  await page.getByRole('button', { name: 'Comparisons', exact: true }).click();
  const paired = await page.evaluate(async () => { const { buildStatistics } = await import('/lib/statistics.js'); return buildStatistics((await window.recall.getWorkspace()).state).confidence; });
  assert.equal(paired.sampleSize, 1);
  // Existing settings and update controls remain reachable from the original local interface.
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('link', { name: /GitHub sync/ }).click();
  await page.getByRole('heading', { name: /GitHub|مزامنة|Recall/i }).first().waitFor();
  await page.goBack();
  await tracking();
  await page.screenshot({ path: path.join(output, 'tracking.png'), fullPage: true });
  await statistics(); await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'statistics.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, 'Mobile layout must not overflow horizontally.');
  assert.deepEqual(errors, [], 'No runtime JavaScript errors.'); assert.deepEqual(externalRequests, [], 'All study workflows use bundled local resources.');
  const result = { result: 'passed', mode: 'localhost Chromium', completePasses: 2, targetedRevisits: 3, viewingSessions: 7, sharedEffortMinutes: 45, verifiedEditPersisted: true, tabs: 6, originalRecallAttemptAndReflection: true, expectedIdeaAssessment: true, matchedConfidence: true, runtimeErrors: errors.length, externalRequests: externalRequests.length, output };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} catch (error) {
  if (inspectionPage) {
    await inspectionPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(output, 'failure.txt'), await inspectionPage.locator('body').innerText().catch(() => 'Page unavailable'));
    console.error(`Synthetic UI diagnostics: ${output}`);
  }
  console.error(error.stack); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
