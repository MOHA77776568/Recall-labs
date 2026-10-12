/** Optional native Electron smoke: node tests/desktop-smoke.cjs
 * Requires Playwright and a desktop display. Uses a fresh temporary profile.
 * RECALL_TEST_NO_SANDBOX=1 is only for restricted Linux test containers.
 */
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const noSandbox = process.env.RECALL_TEST_NO_SANDBOX === '1';

function sourcePdf() {
  const content = 'BT /F1 12 Tf 50 100 Td (Native PDF source text) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recall-desktop-test-'));
  const profile = path.join(directory, 'userData');
  await mkdir(profile, { recursive: true });
  const runner = path.join(directory, 'runner.cjs');
  await writeFile(runner, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(profile)});\nimport(${JSON.stringify(pathToFileURL(path.join(root, 'electron/main.js')).href)});\n`);
  const options = {
    executablePath: require('electron'), args: [runner], cwd: root,
    chromiumSandbox: !noSandbox, timeout: 30_000,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CACHE_HOME: path.join(directory, 'cache') },
  };
  const courseId = randomUUID();
  const cardId = randomUUID();
  const lectureId = randomUUID();
  const question = 'Native smoke: why does local persistence matter?';
  let app;
  let sourceFileId;
  let pdfSourceFileId;
  let reviewDue;
  let reviewedRevision;
  const failures = [];
  const watch = (window) => window.on('pageerror', (error) => failures.push(error.message));
  try {
    app = await _electron.launch(options);
    let window = await app.firstWindow();
    watch(window);
    await window.waitForFunction(() => typeof window.recall?.getWorkspace === 'function');
    const runtime = await app.evaluate(({ app, BrowserWindow }) => ({ profile: app.getPath('userData'), prefs: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() }));
    assert.equal(runtime.profile, profile);
    assert.equal(runtime.prefs.contextIsolation, true);
    assert.equal(runtime.prefs.nodeIntegration, false);
    assert.equal(runtime.prefs.sandbox, true);
    assert.equal(runtime.prefs.webSecurity, true);
    assert.equal(await window.evaluate(() => typeof window.require), 'undefined');

    const initial = await window.evaluate(() => window.recall.getWorkspace());
    const workspace = structuredClone(initial.state);
    workspace.courses.push({ id: courseId, title: 'Native smoke course', description: 'Temporary validation only', color: 'violet' });
    workspace.lectures.push({ id: lectureId, courseId, title: 'Local source', topic: 'Persistence', notes: 'A source that stays on this device.', pages: [] });
    workspace.cards.push({ id: cardId, courseId, lectureId, question, answer: 'The workspace remains available while offline.', tags: ['native-smoke'], source: 'Temporary test', createdAt: new Date().toISOString(), schedule: { due: '1970-01-01T00:00:00.000Z', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } });
    const operationId = randomUUID();
    const payload = { revision: initial.revision, operationId, state: workspace };
    const saved = await window.evaluate((value) => window.recall.saveWorkspace(value), payload);
    assert.equal(saved.revision, initial.revision + 1);
    const retry = await window.evaluate((value) => window.recall.saveWorkspace(value), payload);
    assert.equal(retry.revision, saved.revision, 'Retry must not apply an operation twice.');
    const stale = await window.evaluate(async (value) => {
      try { await window.recall.saveWorkspace(value); return ''; }
      catch (error) { return error.message; }
    }, { ...payload, operationId: randomUUID() });
    assert.match(stale, /revision|changed|conflict|تغيّرت|تغيرت/i);

    const file = await window.evaluate(() => window.recall.storeSourceFile({ name: 'native-source.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('Native source: عربي English') }));
    sourceFileId = file.id;
    const source = await window.evaluate(async (id) => {
      const value = await window.recall.readSourceFile(id);
      return { name: value.name, text: new TextDecoder().decode(value.bytes) };
    }, sourceFileId);
    assert.equal(source.name, 'native-source.txt');
    assert.equal(source.text, 'Native source: عربي English');
    const traversal = await window.evaluate(async () => {
      try { await window.recall.readSourceFile('../library.json'); return ''; }
      catch (error) { return error.message; }
    });
    assert.ok(traversal, 'Source file IDs must not permit path traversal.');

    if (!window.url().includes('/renderer/site/index.html')) {
      await window.getByRole('link', { name: 'فتح Recall Lab', exact: true }).first().click();
    } else {
      await window.reload();
    }
    await window.getByRole('button', { name: 'Sources', exact: true }).click();
    await window.getByRole('button', { name: 'Add source', exact: true }).click();
    await window.getByLabel('Lecture title', { exact: true }).fill('Native PDF lecture');
    const pdf = path.join(directory, 'native-source.pdf');
    await writeFile(pdf, sourcePdf());
    await window.locator('input[type="file"][accept*=".pdf"]').setInputFiles(pdf);
    await window.waitForFunction(() => [...document.querySelectorAll('textarea')].some((element) => element.value.includes('Native PDF source text')));
    await window.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    await window.waitForFunction(async () => (await window.recall.getWorkspace()).state.lectures.some((entry) => entry.title === 'Native PDF lecture' && entry.fileId));
    const pdfLecture = await window.evaluate(async () => (await window.recall.getWorkspace()).state.lectures.find((entry) => entry.title === 'Native PDF lecture'));
    assert.ok(pdfLecture.notes.includes('Native PDF source text'));
    assert.ok(pdfLecture.pages.length);
    pdfSourceFileId = pdfLecture.fileId;
    await window.getByRole('button', { name: 'Overview', exact: true }).click();
    await window.getByRole('button', { name: 'Review due cards', exact: true }).click();
    await window.getByText(question, { exact: true }).waitFor();
    await window.getByRole('button', { name: 'Reveal answer', exact: true }).click();
    await window.getByRole('button', { name: /^Good\b/ }).click();
    await window.waitForFunction(async (id) => (await window.recall.getWorkspace()).state.reviews.some((entry) => entry.cardId === id), cardId);
    const reviewed = await window.evaluate(() => window.recall.getWorkspace());
    const card = reviewed.state.cards.find((entry) => entry.id === cardId);
    assert.equal(card.schedule.reps, 1);
    assert.ok(Date.parse(card.schedule.due) > Date.parse('1970-01-01T00:00:00.000Z'));
    assert.ok(card.schedule.last_review);
    assert.ok(Date.parse(card.schedule.due) > Date.parse(card.schedule.last_review));
    assert.equal(reviewed.state.reviews.filter((entry) => entry.cardId === cardId).length, 1);
    reviewDue = card.schedule.due;
    reviewedRevision = reviewed.revision;
    const backups = await window.evaluate(() => window.recall.getWorkspaceBackups());
    assert.ok(backups.backups.length >= 2, 'Saving and reviewing must retain prior versions.');
    const backup = await window.evaluate((id) => window.recall.getWorkspaceBackup(id), backups.backups[0].id);
    assert.ok(backup.state.courses.some((entry) => entry.id === courseId));
    await window.screenshot({ path: path.join(directory, 'original-ui.png'), fullPage: true });

    await window.getByRole('link', { name: /GitHub sync/ }).click();
    await window.waitForFunction(() => typeof window.recall?.getState === 'function');
    const publicState = await window.evaluate(() => window.recall.getState());
    assert.equal(publicState.runtime, 'electron');
    assert.equal(publicState.settings.tokenConfigured, false);
    assert.equal(publicState.settings.allowPublicSync, false);
    const exposedKeys = JSON.stringify(publicState);
    assert.ok(!/"(?:encryptedToken|token|credential)"\s*:/.test(exposedKeys));
    assert.equal(publicState.workspaceDocument.schemaVersion, 2);
    const secureStorage = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text');
    const fakeToken = 'native-smoke-dummy-not-a-real-token';
    const credentialAttempt = await window.evaluate(async (token) => {
      try { return { state: await window.recall.saveSettings({ token }) }; }
      catch (error) { return { error: error.message }; }
    }, fakeToken);
    if (secureStorage) {
      assert.equal(credentialAttempt.state.settings.tokenConfigured, true);
      assert.ok(!JSON.stringify(credentialAttempt.state).includes(fakeToken));
      assert.ok(!(await readFile(path.join(profile, 'library.json'), 'utf8')).includes(fakeToken));
      const cleared = await window.evaluate(() => window.recall.saveSettings({ token: '' }));
      assert.equal(cleared.settings.tokenConfigured, false);
    } else {
      assert.match(credentialAttempt.error, /secure|credential|storage|encryption/i);
      assert.equal((await window.evaluate(() => window.recall.getState())).settings.tokenConfigured, false);
      assert.ok(!(await readFile(path.join(profile, 'library.json'), 'utf8')).includes(fakeToken));
    }
    const update = await window.evaluate(async () => {
      try { return await window.recall.checkForUpdates(); }
      catch (error) { return { status: 'unsupported', message: error.message }; }
    });
    assert.ok(['unsupported', 'unavailable'].includes(update.status) || /packaged|Windows|المثبتة|development/i.test(update.message));

    const untrusted = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const secondary = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      try {
        await secondary.loadURL('data:text/html,<title>Untrusted smoke frame</title>');
        return await secondary.webContents.executeJavaScript('window.recall.getState().then(() => "unexpected success", error => error.message)');
      } finally { secondary.destroy(); }
    }, path.join(root, 'electron/preload.cjs'));
    assert.match(untrusted, /untrusted|local application|trusted/i);

    await app.close();
    app = await _electron.launch(options);
    window = await app.firstWindow();
    watch(window);
    await window.waitForFunction(() => typeof window.recall?.getWorkspace === 'function');
    const restored = await window.evaluate(() => window.recall.getWorkspace());
    assert.equal(restored.revision, reviewedRevision);
    assert.equal(restored.state.cards.find((entry) => entry.id === cardId).schedule.due, reviewDue);
    assert.equal(restored.state.cards.find((entry) => entry.id === cardId).schedule.reps, 1);
    assert.equal(restored.state.reviews.filter((entry) => entry.cardId === cardId).length, 1);
    assert.equal((await window.evaluate(() => window.recall.getState())).settings.tokenConfigured, false);
    const restoredSource = await window.evaluate(async (id) => new TextDecoder().decode((await window.recall.readSourceFile(id)).bytes), sourceFileId);
    assert.equal(restoredSource, 'Native source: عربي English');
    const restoredPdf = await window.evaluate(async (id) => new TextDecoder().decode((await window.recall.readSourceFile(id)).bytes), pdfSourceFileId);
    assert.ok(restoredPdf.startsWith('%PDF-1.4'));
    const disk = await readFile(path.join(profile, 'library.json'), 'utf8');
    assert.ok(disk.includes(courseId));
    assert.deepEqual(failures, [], 'The native renderer must not raise JavaScript errors.');
    console.log(JSON.stringify({ result: 'passed', profile, originalUI: true, durableWorkspace: true, sourceFiles: true, nativePDF: true, reviewScheduling: true, retryAndRevisionSafety: true, backups: true, trustedSettingsNavigation: true, untrustedIPCRejected: true, secureCredentialStorage: secureStorage ? 'encrypted-and-cleared' : 'fails-closed', credentialNotExposed: true, developmentUpdateStatus: update.status, chromiumSandbox: !noSandbox }, null, 2));
  } finally {
    if (app) await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
