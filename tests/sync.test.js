import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard, deleteCard, emptyDocument, mergeDocuments, parseDocument,
  resolveConflict, restoreCard, reviewCard, serializeDocument, updateCard, validateDocument,
} from '../lib/data.js';
import { GitHubSyncClient, validateGitHubConfig } from '../lib/github.js';

const FIRST = '2026-10-01T10:00:00.000Z';
const SECOND = '2026-10-02T10:00:00.000Z';
const THIRD = '2026-10-03T10:00:00.000Z';
const config = { owner: 'MOHA77776568', repo: 'Recall-labs', branch: 'main', path: 'data/flashcards.json' };
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
function card(fields = {}) { return createCard({ front: 'Question?', back: 'Answer.', ...fields }, FIRST); }
function doc(cards = [], progress = []) { return validateDocument({ schemaVersion: 1, cards, progress }); }
function jsonResponse(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function contents(document, sha = SHA_A) {
  const text = serializeDocument(document);
  return jsonResponse({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text), sha });
}

test('data round trips Unicode, multiline plain text and stable UUIDs', () => {
  const entry = card({ front: 'ما معنى <tag>؟', back: 'الجواب\nسطر آخر', tags: ['node', 'Arabic', 'node'] });
  const document = doc([entry]);
  assert.deepEqual(parseDocument(serializeDocument(document)), document);
  assert.deepEqual(entry.tags, ['Arabic', 'node']);
  assert.equal(updateCard(entry, { back: 'Updated' }, SECOND).id, entry.id);
});

test('malformed documents, duplicate IDs, invalid dates and orphan progress are rejected', () => {
  const entry = card();
  assert.throws(() => validateDocument({ schemaVersion: 2, cards: [], progress: [] }), /schema version/);
  assert.throws(() => doc([entry, entry]), /Duplicate card/);
  assert.throws(() => doc([{ ...entry, updatedAt: '2026-02-30T10:00:00Z' }]), /invalid/);
  assert.throws(() => doc([{ ...entry, front: 'secret\u0000text' }]), /plain text/);
  assert.throws(() => doc([{ ...entry, front: 'x'.repeat(5001) }]), /5000/);
  assert.throws(() => parseDocument('not json'), /valid JSON/);
  assert.throws(() => doc([], [reviewCard(null, entry.id, 'good', FIRST)]), /missing card/);
  assert.throws(() => validateDocument({ ...emptyDocument(), token: 'not allowed' }), /unsupported fields/);
});

test('new local and remote cards merge without loss', () => {
  const local = card({ front: 'Local' });
  const remote = card({ front: 'Remote' });
  const result = mergeDocuments(doc([local]), doc([remote]));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.document.cards.length, 2);
});

test('three-way merge accepts sequential changes while retaining remote additions', () => {
  const initial = card();
  const changed = updateCard(initial, { front: 'Latest' }, SECOND);
  const extra = card({ front: 'Laptop addition' });
  const result = mergeDocuments(doc([initial]), doc([changed, extra]), doc([initial]));
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.document, doc([changed, extra]));
});

test('three-way merge combines edits to independent card fields', () => {
  const initial = card();
  const local = updateCard(initial, { front: 'New question' }, SECOND);
  const remote = updateCard(initial, { back: 'New answer' }, THIRD);
  const result = mergeDocuments(doc([local]), doc([remote]), doc([initial]));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.document.cards[0].front, 'New question');
  assert.equal(result.document.cards[0].back, 'New answer');
  assert.equal(result.document.cards[0].updatedAt, THIRD);
});

test('concurrent edits retain alternatives and deterministic ties', () => {
  const initial = card();
  const local = updateCard(initial, { back: 'Local answer' }, SECOND);
  const remote = updateCard(initial, { back: 'Remote answer' }, SECOND);
  const result = mergeDocuments(doc([local]), doc([remote]), doc([initial]));
  const reverse = mergeDocuments(doc([remote]), doc([local]), doc([initial]));
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, 'same-timestamp');
  assert.equal(result.conflicts[0].id, `card:${initial.id}`);
  assert.deepEqual(result.conflicts[0].local, local);
  assert.deepEqual(result.conflicts[0].remote, remote);
  assert.deepEqual(result.document, reverse.document);
});

test('different data without a shared baseline is a conflict, even with different clocks', () => {
  const initial = card();
  const remote = updateCard(initial, { back: 'Other answer' }, THIRD);
  assert.equal(mergeDocuments(doc([initial]), doc([remote])).conflicts.length, 1);
});

test('tombstones propagate without resurrecting a stale card', () => {
  const initial = card();
  const deleted = deleteCard(initial, SECOND);
  const result = mergeDocuments(doc([initial]), doc([deleted]), doc([initial]));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.document.cards[0].deletedAt, SECOND);
  const sparse = mergeDocuments(emptyDocument(), doc([deleted]));
  assert.equal(sparse.document.cards[0].deletedAt, SECOND);
  const absentBoth = mergeDocuments(emptyDocument(), emptyDocument(), doc([deleted]));
  assert.equal(absentBoth.document.cards[0].deletedAt, SECOND);
});

test('edit/delete race stays deleted until a conscious choice resolves it', () => {
  const initial = card();
  const local = updateCard(initial, { back: 'An offline edit' }, THIRD);
  const remote = deleteCard(initial, SECOND);
  const result = mergeDocuments(doc([local]), doc([remote]), doc([initial]));
  assert.equal(result.conflicts[0].reason, 'delete-edit');
  assert.equal(result.document.cards[0].deletedAt, SECOND);
  const resolved = resolveConflict(result.document, result.conflicts[0], 'local', THIRD);
  assert.equal(resolved.cards[0].deletedAt, undefined);
  assert.equal(resolved.cards[0].back, 'An offline edit');
  assert.equal(mergeDocuments(resolved, doc([remote]), doc([remote])).conflicts.length, 0);
  assert.equal(restoreCard(remote, THIRD).deletedAt, undefined);
  assert.throws(() => updateCard(remote, { back: 'Hidden edit' }), /Restore/);
});

test('review scheduler works locally and again creates a ten-minute review', () => {
  const entry = card();
  const first = reviewCard(null, entry.id, 'good', FIRST);
  assert.equal(first.intervalDays, 1);
  assert.equal(first.repetitions, 1);
  assert.equal(first.dueAt, '2026-10-02T10:00:00.000Z');
  const second = reviewCard(first, entry.id, 'good', SECOND);
  assert.equal(second.intervalDays, 6);
  const again = reviewCard(second, entry.id, 'again', THIRD);
  assert.equal(again.repetitions, 0);
  assert.equal(again.dueAt, '2026-10-03T10:10:00.000Z');
  assert.throws(() => reviewCard(null, entry.id, 'wrong'), /rating/);
});

test('card and progress conflicts have different IDs and can resolve independently', () => {
  const initial = card();
  const initialProgress = reviewCard(null, initial.id, 'good', FIRST);
  const left = doc([updateCard(initial, { back: 'Local' }, SECOND)], [reviewCard(initialProgress, initial.id, 'hard', SECOND)]);
  const right = doc([updateCard(initial, { back: 'Remote' }, SECOND)], [reviewCard(initialProgress, initial.id, 'easy', SECOND)]);
  const result = mergeDocuments(left, right, doc([initial], [initialProgress]));
  assert.equal(result.conflicts.length, 2);
  assert.equal(new Set(result.conflicts.map((conflict) => conflict.id)).size, 2);
  const progressConflict = result.conflicts.find((conflict) => conflict.kind === 'progress');
  assert.equal(resolveConflict(result.document, progressConflict, 'remote', THIRD).progress[0].intervalDays, 4);
});

test('GitHub config rejects traversal, injected refs and foreign API hosts', async () => {
  assert.deepEqual(validateGitHubConfig({ owner: config.owner, repo: config.repo }), config);
  for (const path of ['/absolute.json', '../private.json', 'data/../../x', 'data//x', 'data/%2e%2e/x', 'data\\x']) assert.throws(() => validateGitHubConfig({ ...config, path }), /path/);
  for (const branch of ['../main', 'main..other', 'main\nAuthorization:x', 'x@{1}', 'x.lock', 'a//b']) assert.throws(() => validateGitHubConfig({ ...config, branch }), /branch/);
  assert.equal(validateGitHubConfig({ ...config, branch: 'feature/cards' }).branch, 'feature/cards');
  const client = new GitHubSyncClient({ fetchImpl: () => assert.fail('Must not fetch') });
  await assert.rejects(client.request('https://example.com', { token: 'secret' }), { code: 'INVALID_URL' });
});

test('public GitHub reads work without a token and do not send authorization', async () => {
  const document = doc([card({ front: 'مرحبا' })]);
  let checked = false;
  const client = new GitHubSyncClient({ fetchImpl: async (url, options) => {
    checked = true;
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/MOHA77776568\/Recall-labs\/contents\/data\/flashcards\.json\?ref=main$/);
    return contents(document);
  } });
  assert.deepEqual((await client.read(config)).document, document);
  assert.equal(checked, true);
});

test('repository metadata reports confirmed privacy for upload preflight', async () => {
  const client = new GitHubSyncClient({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/MOHA77776568/Recall-labs');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return jsonResponse({ private: false, default_branch: 'main' });
  } });
  assert.deepEqual(await client.repositoryInfo({ ...config, token: 'test-token' }), { private: false, defaultBranch: 'main' });
  const unknown = new GitHubSyncClient({ fetchImpl: async () => jsonResponse({ default_branch: 'main' }) });
  await assert.rejects(unknown.repositoryInfo(config), { code: 'INVALID_RESPONSE' });
});

test('missing data file requires an existing repository branch', async () => {
  let calls = 0;
  const client = new GitHubSyncClient({ fetchImpl: async () => ++calls === 1 ? jsonResponse({}, 404) : jsonResponse({ name: 'main' }) });
  assert.deepEqual(await client.read(config), { document: emptyDocument(), sha: null, missing: true });
  assert.equal(calls, 2);
  const emptyRepo = new GitHubSyncClient({ fetchImpl: async () => jsonResponse({}, 404) });
  await assert.rejects(emptyRepo.read(config), { code: 'REMOTE_BRANCH_UNAVAILABLE' });
});

test('sync pulls remote additions without needing upload credentials', async () => {
  const remote = doc([card({ front: 'Added through GitHub' })]);
  const client = new GitHubSyncClient({ fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'GET');
    return contents(remote);
  } });
  const result = await client.sync({ config, document: emptyDocument() });
  assert.deepEqual(result.document, remote);
  assert.equal(result.pushed, false);
});

test('sync writes a frozen merge with expected SHA and keeps tokens out of content', async () => {
  const local = doc([card({ front: 'On this computer' })]);
  const remote = doc([card({ front: 'On the laptop' })]);
  let uploaded;
  const client = new GitHubSyncClient({ fetchImpl: async (_url, options) => {
    if (options.method === 'GET') return contents(remote);
    uploaded = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(uploaded.sha, SHA_A);
    assert.equal(uploaded.branch, 'main');
    assert.equal(options.body.includes('test-token'), false);
    return jsonResponse({ content: { sha: SHA_B } }, 201);
  } });
  const result = await client.sync({ config, document: local, token: 'test-token', allowPublicSync: true });
  assert.equal(result.pushed, true);
  assert.equal(result.sha, SHA_B);
  assert.deepEqual(parseDocument(Buffer.from(uploaded.content, 'base64').toString('utf8')), result.document);
  assert.equal(result.document.cards.length, 2);
});

test('sync avoids upload on conflicts and returns a usable remote baseline', async () => {
  const initial = card();
  const local = doc([updateCard(initial, { back: 'Local' }, SECOND)]);
  const remote = doc([updateCard(initial, { back: 'Remote' }, THIRD)]);
  const client = new GitHubSyncClient({ fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'GET');
    return contents(remote);
  } });
  const result = await client.sync({ config, document: local, baseDocument: doc([initial]), token: 'test-token' });
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.remoteDocument, remote);
  assert.equal(result.pushed, false);
});

test('SHA conflict triggers a reread, merge and safe retry', async () => {
  const local = doc([card({ front: 'Local' })]);
  const remote = doc([card({ front: 'Remote during retry' })]);
  let reads = 0;
  let writes = 0;
  const client = new GitHubSyncClient({ fetchImpl: async (_url, options) => {
    if (options.method === 'GET') return ++reads === 1 ? contents(emptyDocument()) : contents(remote, SHA_B);
    const body = JSON.parse(options.body);
    if (++writes === 1) { assert.equal(body.sha, SHA_A); return jsonResponse({}, 409); }
    assert.equal(body.sha, SHA_B);
    assert.equal(parseDocument(Buffer.from(body.content, 'base64').toString('utf8')).cards.length, 2);
    return jsonResponse({ content: { sha: SHA_C } });
  } });
  const result = await client.sync({ config, document: local, token: 'test-token', allowPublicSync: true });
  assert.equal(result.pushed, true);
  assert.equal(result.document.cards.length, 2);
  assert.equal(reads, 2);
  assert.equal(writes, 2);
});

test('a concurrent edit found during retry becomes a conflict instead of overwriting', async () => {
  const initial = card();
  const local = doc([updateCard(initial, { back: 'Local edit' }, SECOND)]);
  const concurrent = doc([updateCard(initial, { back: 'Concurrent edit' }, THIRD)]);
  let reads = 0;
  let writes = 0;
  const client = new GitHubSyncClient({ fetchImpl: async (_url, options) => {
    if (options.method === 'GET') return ++reads === 1 ? contents(doc([initial])) : contents(concurrent, SHA_B);
    writes += 1;
    return jsonResponse({}, 409);
  } });
  const result = await client.sync({ config, document: local, baseDocument: doc([initial]), token: 'test-token', allowPublicSync: true });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.pushed, false);
  assert.equal(writes, 1);
});

test('repeated SHA rejections are bounded', async () => {
  let writes = 0;
  const client = new GitHubSyncClient({ maxRetries: 1, fetchImpl: async (_url, options) => {
    if (options.method === 'GET') return contents(emptyDocument());
    writes += 1;
    return jsonResponse({}, 422);
  } });
  await assert.rejects(client.sync({ config, document: doc([card()]), token: 'test-token', allowPublicSync: true }), { code: 'SYNC_RACE' });
  assert.equal(writes, 2);
});

test('unauthorized requests and missing write permission have actionable errors', async () => {
  const client = new GitHubSyncClient({ fetchImpl: async () => jsonResponse({ message: 'secret response' }, 401) });
  await assert.rejects(client.read({ ...config, token: 'private-token' }), (error) => error.code === 'AUTH_REQUIRED' && !error.message.includes('private-token') && !error.message.includes('secret response'));
  const noToken = new GitHubSyncClient({ fetchImpl: async () => contents(emptyDocument()) });
  await assert.rejects(noToken.sync({ config, document: doc([card()]) }), { code: 'AUTH_REQUIRED' });
  const denied = new GitHubSyncClient({ fetchImpl: async () => jsonResponse({}, 403) });
  await assert.rejects(denied.read(config), { code: 'ACCESS_DENIED' });
});

test('network errors do not expose transport error details or saved tokens', async () => {
  const client = new GitHubSyncClient({ fetchImpl: async () => { throw new Error('Authorization: Bearer private-token'); } });
  await assert.rejects(client.read({ ...config, token: 'private-token' }), (error) => error.code === 'NETWORK_ERROR' && !error.message.includes('private-token'));
});

test('public uploads are blocked by default and require explicit consent', async () => {
  let writes = 0;
  const client = new GitHubSyncClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/Recall-labs')) return jsonResponse({ private: false, default_branch: 'main' });
    if (options.method === 'GET') return contents(emptyDocument());
    writes += 1;
    return jsonResponse({ content: { sha: SHA_B } });
  } });
  const request = { config, document: doc([card()]), token: 'test-token' };
  await assert.rejects(client.sync(request), { code: 'PUBLIC_REPOSITORY_PRIVACY' });
  assert.equal(writes, 0);
  assert.equal((await client.sync({ ...request, allowPublicSync: true })).pushed, true);
  assert.equal(writes, 1);
  await assert.rejects(client.sync({ ...request, allowPublicSync: 'true' }), { code: 'INVALID_CONFIG' });
});

test('private repository uploads pass the default privacy gate', async () => {
  let metadataReads = 0;
  const client = new GitHubSyncClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/Recall-labs')) { metadataReads += 1; return jsonResponse({ private: true, default_branch: 'main' }); }
    if (options.method === 'GET') return contents(emptyDocument());
    return jsonResponse({ content: { sha: SHA_B } });
  } });
  assert.equal((await client.sync({ config, document: doc([card()]), token: 'test-token' })).pushed, true);
  assert.equal(metadataReads, 1);
});

test('unknown repository privacy never permits an upload', async () => {
  const client = new GitHubSyncClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/Recall-labs')) return jsonResponse({ default_branch: 'main' });
    assert.equal(options.method, 'GET');
    return contents(emptyDocument());
  } });
  await assert.rejects(client.sync({ config, document: doc([card()]), token: 'test-token' }), { code: 'INVALID_RESPONSE' });
});

test('document codec hooks support other schemas through the same bounded transport', async () => {
  const empty = () => ({ schemaVersion: 2, items: [] });
  const validate = (document) => {
    assert.equal(document.schemaVersion, 2);
    assert.ok(Array.isArray(document.items));
    return structuredClone(document);
  };
  const merge = (local, remote, base) => {
    assert.equal(base.schemaVersion, 2);
    return { document: { schemaVersion: 2, items: [...new Set([...local.items, ...remote.items])].sort() }, conflicts: [] };
  };
  let uploaded;
  const remote = { schemaVersion: 2, items: ['laptop'] };
  const client = new GitHubSyncClient({
    validateDocument: validate, mergeDocuments: merge, emptyDocument: empty,
    fetchImpl: async (url, options) => {
      assert.match(url, /data\/workspace\.json/);
      if (options.method === 'GET') {
        const text = JSON.stringify(remote);
        return jsonResponse({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text), sha: SHA_A });
      }
      uploaded = JSON.parse(Buffer.from(JSON.parse(options.body).content, 'base64').toString('utf8'));
      return jsonResponse({ content: { sha: SHA_B } });
    },
  });
  const result = await client.sync({ config: { ...config, path: 'data/workspace.json' }, document: { schemaVersion: 2, items: ['desktop'] }, token: 'test-token', allowPublicSync: true });
  assert.deepEqual(result.document, { schemaVersion: 2, items: ['desktop', 'laptop'] });
  assert.deepEqual(uploaded, result.document);
  const noFile = new GitHubSyncClient({ validateDocument: validate, mergeDocuments: merge, emptyDocument: empty, fetchImpl: async (url) => url.includes('/contents/') ? jsonResponse({}, 404) : jsonResponse({ name: 'main' }) });
  assert.deepEqual((await noFile.read(config)).document, empty());
});

test('large workspace reads use the immutable raw blob SHA on the same API domain', async () => {
  const document = { schemaVersion: 2, notes: 'n'.repeat(1_100_000) };
  const text = JSON.stringify(document);
  const size = Buffer.byteLength(text);
  let rawReads = 0;
  const fetchImpl = async (url, options) => {
    if (url.includes('/contents/')) return jsonResponse({ type: 'file', encoding: 'none', content: '', size, sha: SHA_A });
    rawReads += 1;
    assert.equal(url, `https://api.github.com/repos/MOHA77776568/Recall-labs/git/blobs/${SHA_A}`);
    assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    return new Response(text);
  };
  const validate = (input) => { assert.equal(input.schemaVersion, 2); return structuredClone(input); };
  const client = new GitHubSyncClient({ fetchImpl, validateDocument: validate, maxDocumentBytes: 10_000_000 });
  assert.deepEqual((await client.read({ ...config, token: 'test-token' })).document, document);
  assert.equal(rawReads, 1);
  const ordinary = new GitHubSyncClient({ fetchImpl, validateDocument: validate });
  await assert.rejects(ordinary.read(config), { code: 'REMOTE_TOO_LARGE' });
  assert.equal(rawReads, 1, 'default bound rejects metadata before requesting a large blob');
  assert.throws(() => new GitHubSyncClient({ maxDocumentBytes: 10_000_001 }), /byte limit/);
});

test('large workspace uploads retain the configured byte limit and optimistic SHA', async () => {
  const empty = () => ({ schemaVersion: 2, notes: '' });
  const local = { schemaVersion: 2, notes: 'ل'.repeat(600_000) };
  const validate = (input) => { assert.equal(input.schemaVersion, 2); return structuredClone(input); };
  let writes = 0;
  const client = new GitHubSyncClient({
    maxDocumentBytes: 10_000_000, emptyDocument: empty, validateDocument: validate,
    mergeDocuments: (left) => ({ document: left, conflicts: [] }),
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        const text = JSON.stringify(empty());
        return jsonResponse({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text), sha: SHA_A });
      }
      const body = JSON.parse(options.body);
      const bytes = Buffer.from(body.content, 'base64');
      assert.equal(body.sha, SHA_A);
      assert.ok(bytes.byteLength > 1_000_000);
      assert.deepEqual(JSON.parse(bytes.toString('utf8')), local);
      writes += 1;
      return jsonResponse({ content: { sha: SHA_B } });
    },
  });
  assert.equal((await client.sync({ config, document: local, token: 'test-token', allowPublicSync: true })).pushed, true);
  assert.equal(writes, 1);
  client.maxDocumentBytes = 1_000;
  await assert.rejects(client.sync({ config, document: local, token: 'test-token', allowPublicSync: true }), { code: 'DATA_TOO_LARGE' });
  assert.equal(writes, 1);
});

test('raw blob bodies are bounded, length checked, UTF-8 checked and JSON checked', async () => {
  const cases = [
    { body: 'x'.repeat(21), size: 1, code: 'REMOTE_TOO_LARGE' },
    { body: '{}', size: 3, code: 'INVALID_RESPONSE' },
    { body: Uint8Array.of(255), size: 1, code: 'INVALID_RESPONSE' },
    { body: '{bad', size: 4, code: 'INVALID_RESPONSE' },
  ];
  for (const entry of cases) {
    const client = new GitHubSyncClient({
      maxDocumentBytes: 20,
      validateDocument: (input) => input,
      fetchImpl: async (url) => url.includes('/contents/')
        ? jsonResponse({ type: 'file', encoding: 'none', content: '', size: entry.size, sha: SHA_A })
        : new Response(entry.body),
    });
    await assert.rejects(client.read(config), { code: entry.code });
  }
});

test('remote malformed JSON, oversized bodies and invalid UTF-8 are rejected', async () => {
  const malformed = new GitHubSyncClient({ fetchImpl: async () => jsonResponse({ type: 'file', encoding: 'base64', content: Buffer.from('{bad').toString('base64'), size: 4, sha: SHA_A }) });
  await assert.rejects(malformed.read(config), /valid JSON/);
  const oversized = new GitHubSyncClient({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '1600001' } }) });
  await assert.rejects(oversized.read(config), { code: 'REMOTE_TOO_LARGE' });
  const invalidUtf8 = new GitHubSyncClient({ fetchImpl: async () => jsonResponse({ type: 'file', encoding: 'base64', content: '/w==', size: 1, sha: SHA_A }) });
  await assert.rejects(invalidUtf8.read(config), { code: 'INVALID_RESPONSE' });
  const directory = new GitHubSyncClient({ fetchImpl: async () => jsonResponse([]) });
  await assert.rejects(directory.read(config), { code: 'INVALID_RESPONSE' });
});
