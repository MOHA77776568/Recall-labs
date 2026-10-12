import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, StoreCorruptionError, OperationQueue } from '../electron/storage.js';
import { AttachmentStore } from '../electron/attachments.js';

async function temporaryStore(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recall-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new JsonStore(directory, options);
}

test('atomic replacement retains bounded backups of the previous state', async (t) => {
  const store = await temporaryStore(t, { backupLimit: 2 });
  assert.equal(await store.load(), null);
  for (let revision = 0; revision < 5; revision++) await store.save({ revision });
  assert.deepEqual(await store.load(), { revision: 4 });
  const backups = (await readdir(store.backupDirectory)).sort();
  assert.equal(backups.length, 2);
  const revisions = await Promise.all(backups.map(async (name) => JSON.parse(await readFile(path.join(store.backupDirectory, name), 'utf8')).revision));
  assert.deepEqual(revisions.sort(), [2, 3]);
  assert.deepEqual((await readdir(store.directory)).sort(), ['backups', 'library.json']);
});

test('malformed or invalid existing data is reported and left intact', async (t) => {
  const store = await temporaryStore(t, { validate: (value) => {
    if (!Number.isInteger(value.revision)) throw new Error('Missing revision.');
    return value;
  } });
  for (const contents of ['broken json', '{"revision":"bad"}']) {
    await writeFile(store.filename, contents);
    await assert.rejects(store.load(), StoreCorruptionError);
    assert.equal(await readFile(store.filename, 'utf8'), contents);
  }
});

test('validation prevents overwriting valid data with unsupported state', async (t) => {
  const store = await temporaryStore(t, { validate: (value) => {
    if (!Number.isInteger(value.revision)) throw new Error('Missing revision.');
    return value;
  } });
  await store.save({ revision: 1 });
  await assert.rejects(store.save({ revision: 'invalid' }), /Missing revision/);
  assert.deepEqual(await store.load(), { revision: 1 });
});

test('mutations execute serially and a failure does not poison later operations', async () => {
  const queue = new OperationQueue();
  let release;
  const first = queue.run(async () => { await new Promise((resolve) => { release = resolve; }); return 'first'; });
  let secondStarted = false;
  const second = queue.run(async () => { secondStarted = true; throw new Error('expected failure'); });
  const third = queue.run(() => 'third');
  const rejected = assert.rejects(second, /expected failure/);
  await Promise.resolve();
  assert.equal(secondStarted, false);
  release();
  assert.equal(await first, 'first');
  await rejected;
  assert.equal(await third, 'third');
});

test('backup preview exposes only saved IDs and rejects path traversal', async (t) => {
  const store = await temporaryStore(t);
  await store.save({ revision: 1 });
  await store.save({ revision: 2 });
  const backups = await store.listBackups();
  assert.equal(backups.length, 1);
  assert.ok(Number.isFinite(Date.parse(backups[0].createdAt)));
  assert.deepEqual(await store.readBackup(backups[0].id), { revision: 1 });
  await assert.rejects(store.readBackup('../library.json'), /Invalid backup ID/);
});

test('local attachments survive reopening and do not accept arbitrary filesystem paths', async (t) => {
  const store = await temporaryStore(t);
  const attachments = new AttachmentStore(path.join(store.directory, 'attachments'));
  const bytes = new TextEncoder().encode('Recall notes \u0645\u0644\u0627\u062d\u0638\u0627\u062a');
  const saved = await attachments.save({ name: 'lecture.txt', bytes });
  const reopened = await new AttachmentStore(attachments.directory).read(saved.id);
  assert.equal(reopened.name, 'lecture.txt');
  assert.equal(reopened.mimeType, 'text/plain');
  assert.deepEqual(reopened.bytes, bytes);
  await assert.rejects(attachments.save({ name: '../private.txt', bytes }), /filename/);
  await assert.rejects(attachments.save({ name: 'run.exe', bytes }), /PDF, TXT/);
  await assert.rejects(attachments.save({ name: 'empty.pdf', bytes: new Uint8Array() }), /between 1 byte and 15 MB/);
  await assert.rejects(attachments.read('../library.json'), /Invalid local source file ID/);
  assert.deepEqual((await attachments.read(saved.id)).bytes, bytes);
});
