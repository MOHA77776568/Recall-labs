import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullWorkspaceBackup, parseFullWorkspaceBackup } from '../lib/card-media-backup.js';
import { analyzeCardImage, CardMediaError } from '../lib/card-media.js';
import { emptyWorkspace, createWorkspaceDocument } from '../lib/workspace.js';
import { createInitialSchedule } from '../renderer/site/fsrs-original.js';
import { syntheticPng } from './helpers/card-images.js';

async function fixture() {
  const bytes = syntheticPng(); const media = await analyzeCardImage(bytes);
  const workspace = emptyWorkspace();
  workspace.courses.push({ id: 'course', title: 'Synthetic عربي course', description: '', color: 'teal' });
  workspace.media.push(media);
  for (const id of ['first', 'second']) workspace.cards.push({ id, courseId: 'course', lectureId: '', question: '', answer: '', tags: ['synthetic'], source: '', createdAt: '2026-10-01T00:00:00.000Z', schedule: createInitialSchedule(new Date('2026-10-01T00:00:00Z')), questionImages: [{ mediaId: media.id, description: 'Synthetic question' }], answerImages: [{ mediaId: media.id, description: 'Synthetic answer' }] });
  workspace.cards[0].occlusion = { mediaId: media.id, regions: [{ id: 'r', x: .1, y: .2, width: .3, height: .4, label: 'Hidden synthetic label' }], targetRegionId: 'r', hideOthers: true };
  return { bytes, media, document: createWorkspaceDocument(workspace), store: { read: async () => ({ ...media, bytes }) } };
}

test('full ZIP round-trips Unicode, masks, independent schedules and shared image bytes exactly once', async () => {
  const f = await fixture(); const backup = await createFullWorkspaceBackup(f.document, f.store);
  assert.equal(backup.images, 1); assert.equal(backup.complete, true);
  assert.deepEqual([...backup.bytes.slice(0, 4)], [80, 75, 3, 4]);
  const restored = await parseFullWorkspaceBackup(backup.bytes);
  assert.deepEqual(restored.document, f.document);
  assert.equal(restored.images.length, 1); assert.deepEqual(restored.images[0].bytes, f.bytes);
  assert.notEqual(restored.document.workspace.cards[0].id, restored.document.workspace.cards[1].id);
});

test('a missing or mismatched local image refuses to produce a supposedly complete backup', async () => {
  const f = await fixture();
  await assert.rejects(() => createFullWorkspaceBackup(f.document, { read: async () => { throw new CardMediaError('LOCAL_IMAGE_MISSING', 'Missing'); } }), /missing/i);
  await assert.rejects(() => createFullWorkspaceBackup(f.document, { read: async () => ({ bytes: syntheticPng({ color: [1, 2, 3, 255] }) }) }), /match/i);
});

test('truncation, checksum edits, unsupported compression and unsafe paths fail before restore', async () => {
  const f = await fixture(); const backup = await createFullWorkspaceBackup(f.document, f.store);
  await assert.rejects(() => parseFullWorkspaceBackup(backup.bytes.slice(0, -1)), /ZIP|backup/i);
  const changed = backup.bytes.slice(); changed[30 + 'workspace.json'.length + 20] ^= 1;
  await assert.rejects(() => parseFullWorkspaceBackup(changed), /checksum/i);
  const compressed = backup.bytes.slice();
  const view = new DataView(compressed.buffer); const central = view.getUint32(compressed.length - 6, true); view.setUint16(central + 10, 8, true);
  await assert.rejects(() => parseFullWorkspaceBackup(compressed), /compression/i);
  const traversal = backup.bytes.slice(); const old = new TextEncoder().encode('workspace.json'); const evil = new TextEncoder().encode('../private.txt');
  for (let i = 0; i < traversal.length - old.length; i++) {
    if (old.every((byte, j) => traversal[i + j] === byte)) traversal.set(evil, i);
  }
  await assert.rejects(() => parseFullWorkspaceBackup(traversal), /unsafe|filename|path/i);
});

test('data-only JSON contains metadata and references, and an empty ZIP is a complete zero-image backup', async () => {
  const f = await fixture();
  assert.equal(JSON.stringify(f.document).includes('base64'), false);
  const empty = createWorkspaceDocument(emptyWorkspace());
  const backup = await createFullWorkspaceBackup(empty, { read: () => assert.fail('No image reads for an empty workspace.') });
  assert.equal(backup.images, 0); assert.deepEqual((await parseFullWorkspaceBackup(backup.bytes)).document, empty);
});
