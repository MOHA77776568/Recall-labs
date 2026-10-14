/** Real browser/IndexedDB + synthetic image inputs and a routed fake GitHub API.
 * No live repositories, tokens, user data, or internet services are used. */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../scripts/web-server.js';
import { jpegWithOrientation } from './helpers/card-images.js';

const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = await mkdtemp(path.join(os.tmpdir(), 'recall-image-browser-'));
let executablePath = process.env.RECALL_BROWSER_EXECUTABLE;
if (!executablePath) { try { await access(chromium.executablePath()); } catch { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch {} } }
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [], unexpectedRequests = [];
const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && !r.url().startsWith('https://api.github.com/')) unexpectedRequests.push(r.url()); }); };
const state = page => page.evaluate(async () => (await window.recall.getWorkspace()).state);
const images = page => page.getByRole('button', { name: 'Images & occlusion / الصور', exact: true }).click();
const remoteFiles = new Map(); const requests = []; let interruptDownloads = false;
const sha = bytes => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
async function mockGitHub(context) {
  await context.route('https://api.github.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'content-type': 'application/json' };
    const reply = (data, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push({ method: request.method(), path: url.pathname });
    const prefix = '/repos/synthetic-owner/private-data';
    assert.ok(url.pathname.startsWith(prefix), 'No actual user repository is accessed.');
    if (url.pathname === prefix) return reply({ private: true, default_branch: 'main' });
    if (url.pathname === `${prefix}/branches/main`) return reply({ name: 'main' });
    const file = decodeURIComponent(url.pathname.slice(`${prefix}/contents/`.length));
    assert.ok(url.pathname.startsWith(`${prefix}/contents/`));
    if (request.method() === 'PUT') {
      const payload = request.postDataJSON(); const existing = remoteFiles.get(file);
      if (existing && payload.sha !== sha(existing)) return reply({}, 409);
      const content = Buffer.from(payload.content, 'base64'); remoteFiles.set(file, content);
      return reply({ content: { sha: sha(content) } }, 201);
    }
    if (interruptDownloads && file.includes('/media/')) return reply({}, 503);
    const content = remoteFiles.get(file); if (!content) return reply({}, 404);
    return reply({ type: 'file', encoding: 'base64', content: content.toString('base64'), size: content.length, sha: sha(content) });
  });
}

try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
  await mockGitHub(context); await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage(); watch(page); await page.goto(origin); await page.waitForFunction(() => window.recall?.storeCardImage);
  const initial = await page.evaluate(() => window.recall.getWorkspace());
  const workspace = initial.state;
  workspace.courses.push({ id: 'course', title: 'Synthetic عربي images', description: '', color: 'violet' });
  workspace.lectures.push({ id: 'lecture', courseId: 'course', title: 'Synthetic lecture', topic: '', notes: '', pages: [] });
  await page.evaluate(value => window.recall.saveWorkspace(value), { state: workspace, revision: initial.revision, operationId: crypto.randomUUID() }); await page.reload();
  const picture = async (mimeType, color) => page.evaluate(async ({ mimeType, color }) => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 240, 120); ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.fillText('Synthetic · x²', 15, 65);
    const blob = await new Promise(r => canvas.toBlob(r, mimeType)); return [...new Uint8Array(await blob.arrayBuffer())];
  }, { mimeType, color });
  const q = await picture('image/png', '#315ab4'), a = await picture('image/png', '#a43c5b'), jpeg = [...jpegWithOrientation(new Uint8Array(await picture('image/jpeg', '#31865d')))], webp = await picture('image/webp', '#8151ac');
  await images(page); await page.getByRole('button', { name: 'New image card', exact: true }).click();
  const upload = page.locator('input[type="file"][multiple]');
  await upload.setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: Buffer.from(q) });
  await page.getByRole('region', { name: 'Question images', exact: true }).getByLabel('Image description 1', { exact: true }).fill('Question synthetic image');
  await page.getByLabel('Add to', { exact: true }).selectOption('answer');
  await page.evaluate(async bytes => navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]), a);
  await page.getByLabel('Answer text (optional with images)', { exact: true }).focus(); await page.keyboard.press('Control+V');
  await page.getByRole('region', { name: 'Answer images', exact: true }).getByLabel('Image description 1', { exact: true }).fill('Answer secret synthetic image');
  await page.getByLabel('Add to', { exact: true }).selectOption('question');
  const transfer = await page.evaluateHandle(({ jpeg, webp }) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(jpeg)], 'synthetic.jpg', { type: 'image/jpeg' })); data.items.add(new File([new Uint8Array(webp)], 'synthetic.webp', { type: 'image/webp' })); return data;
  }, { jpeg, webp });
  await page.locator('.media-drop').dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByRole('region', { name: 'Question images', exact: true }).getByLabel('Image description 3', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.cards.length === 1);
  const saved = await state(page); assert.equal(saved.cards[0].question, ''); assert.equal(saved.cards[0].questionImages.length, 3); assert.equal(saved.cards[0].answerImages.length, 1); assert.equal(saved.media.length, 4);
  const orientedJpeg = saved.media.find(record => record.mimeType === 'image/jpeg'); assert.equal(orientedJpeg.width, 120); assert.equal(orientedJpeg.height, 240);
  const answerId = saved.cards[0].answerImages[0].mediaId;
  await page.reload(); await page.getByRole('button', { name: 'Review due cards', exact: true }).click();
  await page.getByRole('img', { name: 'Question synthetic image', exact: true }).waitFor();
  assert.equal(await page.getByRole('img', { name: 'Answer secret synthetic image', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click(); await page.getByRole('img', { name: 'Answer secret synthetic image', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Good\b/ }).click(); await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.reviews.length === 1);
  await images(page); await page.getByRole('button', { name: 'New image card', exact: true }).click();
  await upload.setInputFiles({ name: 'shared.png', mimeType: 'image/png', buffer: Buffer.from(q) });
  await page.getByLabel('Image to cover', { exact: true }).selectOption(saved.cards[0].questionImages[0].mediaId);
  await page.getByRole('button', { name: 'Add region using keyboard', exact: true }).click();
  await page.getByLabel('Region label', { exact: true }).fill('Secret region one');
  await page.getByLabel('Left (%)', { exact: true }).fill('10'); await page.getByLabel('Top (%)', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Draw a region', exact: true }).click();
  const board = page.locator('.media-occlusion > .media-occlusion-board'); const box = await board.boundingBox();
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height * .75); await page.mouse.up();
  await page.getByLabel('Region label', { exact: true }).fill('Secret region two');
  const rectangle = board.locator('.media-rectangle').last(); const rectangleBox = await rectangle.boundingBox();
  const leftBefore = Number(await page.getByLabel('Left (%)', { exact: true }).inputValue());
  await page.mouse.move(rectangleBox.x + rectangleBox.width / 2, rectangleBox.y + rectangleBox.height / 2); await page.mouse.down(); await page.mouse.move(rectangleBox.x + rectangleBox.width / 2 + 12, rectangleBox.y + rectangleBox.height / 2 + 8); await page.mouse.up();
  assert.ok(Number(await page.getByLabel('Left (%)', { exact: true }).inputValue()) > leftBefore);
  const handle = await rectangle.locator('.media-resize-handle').boundingBox(); const widthBefore = Number(await page.getByLabel('Width (%)', { exact: true }).inputValue());
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 10, handle.y + handle.height / 2 + 5); await page.mouse.up();
  assert.ok(Number(await page.getByLabel('Width (%)', { exact: true }).inputValue()) > widthBefore);
  await page.getByRole('button', { name: 'Add region using keyboard', exact: true }).click(); await page.getByRole('button', { name: 'Delete selected region', exact: true }).click();
  await page.getByRole('button', { name: 'Generate one card per region', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.cards.length === 3);
  let current = await state(page); const occlusions = current.cards.filter(card => card.occlusion);
  assert.equal(occlusions.length, 2); assert.notEqual(occlusions[0].id, occlusions[1].id); assert.equal(current.media.length, 4);
  assert.equal(current.cards[0].schedule.reps, 1); assert.equal(occlusions[0].schedule.reps, 0);
  await page.getByRole('button', { name: 'Review card', exact: true }).nth(1).click();
  await page.locator('.media-mask.target').first().waitFor(); assert.equal((await page.locator('body').innerText()).includes('Secret region one'), false);
  async function aligned() {
    const area = await page.locator('.media-occlusion-board[role="img"]').first().boundingBox(); const mask = await page.locator('.media-mask.target').first().boundingBox();
    const region = occlusions[0].occlusion.regions.find(r => r.id === occlusions[0].occlusion.targetRegionId);
    assert.ok(Math.abs((mask.x - area.x) / area.width - region.x) < .015); assert.ok(Math.abs(mask.width / area.width - region.width) < .015);
  }
  await aligned(); await page.getByRole('button', { name: 'Enlarge image', exact: true }).click();
  await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: 'Close enlarged image', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await aligned();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  await page.screenshot({ path: path.join(output, 'occlusion-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click(); await page.getByText('Secret region one', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await page.waitForFunction(async () => (await window.recall.getWorkspace()).state.reviews.length === 2);
  current = await state(page);
  assert.equal(current.cards.find(card => card.id === occlusions[0].id).schedule.reps, 1); assert.equal(current.cards.find(card => card.id === occlusions[1].id).schedule.reps, 0);
  // Full portable backup restores the real IndexedDB image files on a fresh profile.
  await images(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(1).click(); await page.getByRole('button', { name: 'Generate one card per region', exact: true }).click();
  await page.getByRole('heading', { name: 'Edit', exact: true }).waitFor({ state: 'hidden' });
  const regenerated = await state(page); assert.equal(regenerated.cards.length, 3); assert.equal(regenerated.cards.find(card => card.id === occlusions[0].id).schedule.reps, 1); assert.equal(regenerated.cards.find(card => card.id === occlusions[1].id).schedule.reps, 0);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Full backup with images', exact: true }).click();
  const download = await downloadPromise; const fullPath = path.join(output, 'full.zip'); await download.saveAs(fullPath); const backupBytes = await readFile(fullPath);
  const restoredContext = await browser.newContext(); await mockGitHub(restoredContext); const restoredPage = await restoredContext.newPage(); watch(restoredPage); await restoredPage.goto(origin);
  await restoredPage.waitForFunction(() => window.recall?.importFullWorkspace);
  const restoredResult = await restoredPage.evaluate(bytes => window.recall.importFullWorkspace({ bytes: new Uint8Array(bytes) }), [...backupBytes]);
  assert.equal(restoredResult.importStatus.complete, true); assert.deepEqual((await state(restoredPage)).cards, (await state(page)).cards);
  assert.equal(await restoredPage.evaluate(async id => (await window.recall.readCardImage(id)).mimeType, answerId), 'image/png');
  // Routed API validates private binary + JSON dependencies together, including retry after partial download.
  const github = { owner: 'synthetic-owner', repo: 'private-data', branch: 'main', path: 'personal/workspace.json' };
  const settings = { github, token: 'synthetic-not-real-token' };
  await page.evaluate(value => window.recall.saveSettings(value), settings);
  const firstSync = await page.evaluate(() => window.recall.syncWorkspace()); assert.equal(firstSync.syncStatus.complete, true);
  assert.equal([...remoteFiles.keys()].filter(file => file.includes('/media/')).length, 4);
  const puts = requests.filter(r => r.method === 'PUT').length;
  await page.evaluate(() => window.recall.syncWorkspace()); assert.equal(requests.filter(r => r.method === 'PUT').length, puts);
  const secondContext = await browser.newContext(); await mockGitHub(secondContext); const second = await secondContext.newPage(); watch(second); await second.goto(origin);
  await second.waitForFunction(() => window.recall?.syncWorkspace); await second.evaluate(value => window.recall.saveSettings(value), settings);
  interruptDownloads = true; const partial = await second.evaluate(() => window.recall.syncWorkspace()); assert.equal(partial.syncStatus.complete, false); assert.equal((await state(second)).cards.length, 3);
  await second.reload(); await images(second); await second.getByRole('button', { name: 'Review card', exact: true }).first().click(); await second.locator('.media-missing').first().waitFor();
  interruptDownloads = false; await second.evaluate(value => window.recall.saveSettings(value), { token: settings.token });
  const retry = await second.evaluate(() => window.recall.syncWorkspace()); assert.equal(retry.syncStatus.complete, true);
  await second.reload(); await images(second); assert.equal(await second.evaluate(async id => (await window.recall.readCardImage(id)).mimeType, answerId), 'image/png');
  assert.equal(requests.filter(r => r.method === 'PUT').length, puts);
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedRequests, []);
  const result = { result: 'passed', uploadPNG: true, clipboardCtrlV: true, droppedJPEGAndWebP: true, imageOnlyCard: true, answerHiddenBeforeReveal: true, persistedAfterReload: true, pointerAndKeyboardMasks: true, masksAlignedAt390: true, independentOcclusionCards: 2, sharedImageFiles: 4, fullZIPRestore: true, twoBrowserDevicesSync: true, repeatedSyncNoDuplicatePuts: true, interruptedDownloadPreservesCardsAndRetries: true, runtimeErrors: 0, output };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { await browser.close(); await new Promise(r => server.close(r)); }
