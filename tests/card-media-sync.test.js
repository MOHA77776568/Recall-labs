import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { synchronizeCardImages, cardImageRepositoryPath } from '../lib/card-media-sync.js';
import { analyzeCardImage, encodeCardImageBase64, decodeCardImageBase64, CardMediaError } from '../lib/card-media.js';
import { CardImageStore } from '../electron/card-images.js';
import { syntheticPng } from './helpers/card-images.js';

const config = { owner: 'example', repo: 'private-data', branch: 'study/device', path: 'archive/personal/workspace.json' };
const token = 'synthetic-test-token';
function json(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }); }
function blobSha(bytes) { return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), Buffer.from(bytes)])).digest('hex'); }

function memoryStore(initial = []) {
  const files = new Map(initial.map((entry) => [entry.id, entry]));
  let saves = 0;
  return { files, get saves() { return saves; },
    async read(id) {
      if (!files.has(id)) throw new CardMediaError('LOCAL_IMAGE_MISSING', 'Synthetic missing image.');
      return structuredClone(files.get(id));
    },
    async save(bytes) {
      const record = await analyzeCardImage(bytes);
      files.set(record.id, { ...record, bytes: new Uint8Array(bytes) });
      saves += 1;
      return record;
    },
  };
}

function githubMock({ privateRepository = true, files = new Map(), raw = false, intercept } = {}) {
  const calls = [];
  const fetchImpl = async (urlString, options) => {
    const url = new URL(urlString);
    const call = { url, options };
    calls.push(call);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const intercepted = await intercept?.(call, files);
    if (intercepted) return intercepted;
    const prefix = `/repos/${config.owner}/${config.repo}`;
    if (url.pathname === prefix) return json({ private: privateRepository, default_branch: 'main' });
    if (url.pathname.startsWith(`${prefix}/contents/`)) {
      const filePath = decodeURIComponent(url.pathname.slice(`${prefix}/contents/`.length));
      if (options.method === 'PUT') {
        const payload = JSON.parse(options.body);
        assert.equal(payload.branch, config.branch);
        assert.equal(Object.hasOwn(payload, 'sha'), false, 'Immutable image path must never be overwritten.');
        if (files.has(filePath)) return json({}, 409);
        const bytes = decodeCardImageBase64(payload.content);
        files.set(filePath, bytes);
        return json({ content: { sha: blobSha(bytes) } }, 201);
      }
      assert.equal(url.searchParams.get('ref'), config.branch);
      if (!files.has(filePath)) return json({}, 404);
      const bytes = files.get(filePath);
      return json({ type: 'file', encoding: raw ? 'none' : 'base64', content: raw ? '' : encodeCardImageBase64(bytes),
        size: bytes.length, sha: blobSha(bytes), download_url: 'https://untrusted.invalid/never-fetch' });
    }
    if (url.pathname.startsWith(`${prefix}/git/blobs/`)) {
      const sha = url.pathname.slice(`${prefix}/git/blobs/`.length);
      const bytes = [...files.values()].find((entry) => blobSha(entry) === sha);
      if (!bytes) return json({}, 404);
      assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
    }
    assert.fail(`Unexpected mocked route: ${url.pathname}`);
  };
  return { fetchImpl, calls, files, putCount: () => calls.filter((call) => call.options.method === 'PUT').length };
}

test('images follow the actual configured data directory and filename rather than application defaults', async () => {
  const record = await analyzeCardImage(syntheticPng());
  assert.equal(cardImageRepositoryPath(config, record), `archive/personal/media/${record.fileName}`);
  assert.equal(cardImageRepositoryPath({ ...config, path: 'workspace.json' }, record), `media/${record.fileName}`);
  assert.throws(() => cardImageRepositoryPath({ ...config, path: '../workspace.json' }, record), /path/);
});

test('two devices upload/download identical bytes, repeat sync idempotently, and retain shared files after card removal', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recall-card-sync-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const first = new CardImageStore(path.join(directory, 'first'));
  const second = new CardImageStore(path.join(directory, 'second'));
  const bytes = syntheticPng();
  const record = await first.save(bytes);
  const github = githubMock();
  const firstUpload = await synchronizeCardImages({ config, token, mediaRecords: [record, record], store: first, phase: 'upload', fetchImpl: github.fetchImpl });
  assert.deepEqual(firstUpload, { complete: true, uploaded: 1, downloaded: 0, missing: [], failures: [] });
  const secondDownload = await synchronizeCardImages({ config, token, mediaRecords: [record], store: second, phase: 'download', fetchImpl: github.fetchImpl });
  assert.equal(secondDownload.downloaded, 1);
  assert.deepEqual((await second.read(record.id)).bytes, bytes);
  assert.equal((await readdir(path.join(directory, 'second'))).length, 2);
  const again = await synchronizeCardImages({ config, token, mediaRecords: [record], store: first, phase: 'upload', fetchImpl: github.fetchImpl });
  assert.equal(again.complete, true);
  assert.equal(again.uploaded, 0);
  assert.equal(github.putCount(), 1);
  const callsBefore = github.calls.length;
  await synchronizeCardImages({ config, token, mediaRecords: [record], store: second, phase: 'download', fetchImpl: github.fetchImpl });
  assert.equal(github.calls.length, callsBefore);
  await synchronizeCardImages({ config, token, mediaRecords: [], store: first, phase: 'upload', fetchImpl: github.fetchImpl });
  assert.equal(github.files.size, 1);
  assert.equal(await first.has(record.id), true);
});

test('private-repository confirmation is mandatory and public consent cannot enable image uploads', async () => {
  const bytes = syntheticPng();
  const record = await analyzeCardImage(bytes);
  const store = memoryStore([{ ...record, bytes }]);
  const github = githubMock({ privateRepository: false });
  const result = await synchronizeCardImages({ config: { ...config, allowPublicSync: true }, token, mediaRecords: [record], store, phase: 'upload', fetchImpl: github.fetchImpl });
  assert.equal(result.complete, false);
  assert.equal(result.failures[0].code, 'PUBLIC_IMAGE_REPOSITORY');
  assert.equal(github.putCount(), 0);
  assert.equal(github.calls.length, 1);
});

test('upload phase repairs an absent local image from a verified existing remote image without a new commit', async () => {
  const bytes = syntheticPng();
  const record = await analyzeCardImage(bytes);
  const store = memoryStore();
  const github = githubMock({ files: new Map([[cardImageRepositoryPath(config, record), bytes]]) });
  const result = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'upload', fetchImpl: github.fetchImpl });
  assert.equal(result.complete, true);
  assert.equal(result.downloaded, 1);
  assert.equal(github.putCount(), 0);
  assert.deepEqual((await store.read(record.id)).bytes, bytes);
});

test('missing dependencies and interrupted downloads remain partial, retryable, and never delete cards or existing local files', async () => {
  const bytes = syntheticPng();
  const record = await analyzeCardImage(bytes);
  const store = memoryStore();
  const missing = githubMock();
  const first = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download', fetchImpl: missing.fetchImpl });
  assert.equal(first.complete, false);
  assert.deepEqual(first.missing, [record.id]);
  assert.equal(store.files.size, 0);
  const github = githubMock({ files: new Map([[cardImageRepositoryPath(config, record), bytes]]) });
  const interrupted = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download', maxRetries: 1,
    fetchImpl: async () => { throw new Error(`failed request with Authorization: Bearer ${token}`); } });
  assert.equal(interrupted.complete, false);
  assert.equal(JSON.stringify(interrupted).includes(token), false);
  const retried = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download', fetchImpl: github.fetchImpl });
  assert.equal(retried.complete, true);
  assert.equal(retried.downloaded, 1);
  assert.equal(store.saves, 1);
});

test('concurrent image creation and uncertain successful PUT are confirmed by rereading the immutable hash path', async () => {
  const bytes = syntheticPng();
  const record = await analyzeCardImage(bytes);
  for (const interrupted of [false, true]) {
    let firstPut = true;
    const store = memoryStore([{ ...record, bytes }]);
    const github = githubMock({ intercept: ({ url, options }, files) => {
      if (options.method !== 'PUT' || !firstPut) return;
      firstPut = false;
      files.set(decodeURIComponent(url.pathname.split('/contents/')[1]), bytes);
      if (interrupted) throw new Error(`Disconnected ${token}`);
      return json({}, 409);
    } });
    const result = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'upload', fetchImpl: github.fetchImpl });
    assert.equal(result.complete, true);
    assert.equal(github.putCount(), 1);
    assert.equal(github.files.size, 1);
  }
});

test('large GitHub contents use only the immutable API blob, validate all bytes, and never follow download_url', async () => {
  const bytes = syntheticPng({ paddingBytes: 1_050_000 });
  const record = await analyzeCardImage(bytes);
  const store = memoryStore();
  const github = githubMock({ raw: true, files: new Map([[cardImageRepositoryPath(config, record), bytes]]) });
  const result = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download', fetchImpl: github.fetchImpl });
  assert.equal(result.complete, true);
  assert.equal(result.downloaded, 1);
  assert.equal(github.calls.length, 2);
  assert.ok(github.calls[1].url.pathname.includes('/git/blobs/'));
  assert.deepEqual((await store.read(record.id)).bytes, bytes);
});

test('corrupt or malformed remote content cannot replace local files or satisfy dependencies', async () => {
  const bytes = syntheticPng();
  const record = await analyzeCardImage(bytes);
  const different = syntheticPng({ color: [22, 33, 44, 255] });
  const store = memoryStore();
  const github = githubMock({ files: new Map([[cardImageRepositoryPath(config, record), different]]) });
  const result = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download', fetchImpl: github.fetchImpl });
  assert.equal(result.complete, false);
  assert.ok(['IMAGE_INTEGRITY', 'INVALID_IMAGE_RESPONSE'].includes(result.failures[0].code));
  assert.equal(store.saves, 0);
  const malicious = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download',
    fetchImpl: async () => json({ type: 'file', encoding: 'base64', content: '!!!!', size: record.byteLength, sha: 'a'.repeat(40) }) });
  assert.equal(malicious.complete, false);
  const huge = await synchronizeCardImages({ config, token, mediaRecords: [record], store, phase: 'download',
    fetchImpl: async () => json({}, 200, { 'content-length': '20000000' }) });
  assert.equal(huge.complete, false);
  assert.equal(huge.failures[0].code, 'REMOTE_IMAGE_TOO_LARGE');
});

test('partial multi-image downloads keep successful files and report only the failed dependencies', async () => {
  const bytes = syntheticPng();
  const first = await analyzeCardImage(bytes);
  const second = await analyzeCardImage(syntheticPng({ color: [100, 90, 80, 255] }));
  const store = memoryStore();
  const github = githubMock({ files: new Map([[cardImageRepositoryPath(config, first), bytes]]) });
  const result = await synchronizeCardImages({ config, token, mediaRecords: [first, second], store, phase: 'download', fetchImpl: github.fetchImpl });
  assert.equal(result.complete, false);
  assert.equal(result.downloaded, 1);
  assert.deepEqual(result.missing, [second.id]);
  assert.deepEqual(result.failures.map((entry) => entry.id), [second.id]);
  assert.equal(store.files.has(first.id), true);
});
