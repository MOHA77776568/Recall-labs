/** Packaged/installed Electron runtime check; exclusively fresh synthetic data. */
const assert = require('node:assert/strict');
const { mkdtemp } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');

async function run() {
  const executablePath = process.env.RECALL_INSTALLED_EXECUTABLE;
  if (!executablePath) throw new Error('Set RECALL_INSTALLED_EXECUTABLE to the built or installed executable.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'recall-installed-'));
  const noSandbox = process.env.RECALL_TEST_NO_SANDBOX === '1';
  const options = { executablePath, args: [], chromiumSandbox: !noSandbox, env: { ...process.env, XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache') } };
  let app; const errors = [];
  try {
    app = await _electron.launch(options); let page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.recall?.storeCardImage);
    const runtime = await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() }));
    assert.equal(runtime.packaged, true); assert.equal(runtime.preferences.sandbox, true); assert.equal(runtime.preferences.contextIsolation, true); assert.equal(runtime.preferences.nodeIntegration, false);
    const original = await page.evaluate(() => window.recall.getWorkspace());
    assert.equal(original.state.cards.length, 0, 'Only an empty disposable installation may be mutated by this test.');
    const { syntheticPng } = await import('./helpers/card-images.js');
    const media = await page.evaluate(bytes => window.recall.storeCardImage({ bytes: new Uint8Array(bytes) }), [...syntheticPng()]);
    const workspace = original.state;
    workspace.courses.push({ id: 'installed-course', title: 'Synthetic installed app', description: '', color: 'teal' });
    workspace.media.push(media);
    workspace.cards.push({ id: 'installed-card', courseId: 'installed-course', lectureId: '', question: '', answer: 'Synthetic installed answer', tags: [], source: '', createdAt: new Date().toISOString(), schedule: { due: '1970-01-01T00:00:00.000Z', state: 0, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0 }, questionImages: [{ mediaId: media.id, description: 'Installed synthetic image' }] });
    await page.evaluate(payload => window.recall.saveWorkspace(payload), { state: workspace, revision: original.revision, operationId: crypto.randomUUID() });
    await page.reload(); await page.getByRole('button', { name: 'Review due cards', exact: true }).click();
    await page.getByRole('img', { name: 'Installed synthetic image', exact: true }).waitFor();
    assert.equal(await page.getByText('Synthetic installed answer', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Reveal answer', exact: true }).click(); await page.getByText('Synthetic installed answer', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Good\b/ }).click();
    await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.reviews.length === 1);
    await app.close(); app = await _electron.launch(options); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.recall?.getWorkspace);
    const restored = await page.evaluate(() => window.recall.getWorkspace());
    assert.equal(restored.state.cards[0].schedule.reps, 1); assert.equal(restored.state.reviews[0].practiceMode, 'closed-book');
    assert.equal(await page.evaluate(async id => (await window.recall.readCardImage(id)).mimeType, media.id), 'image/png');
    await page.getByRole('button', { name: 'Statistics / الإحصاءات', exact: true }).click(); await page.getByRole('heading', { name: 'Statistics', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', packaged: true, installedExecutable: executablePath, imageRendering: true, answerHidden: true, FSRS: true, restart: true, statistics: true, chromiumSandbox: !noSandbox }, null, 2));
  } finally { if (app) await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
