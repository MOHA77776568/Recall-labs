import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  analyzeCardImage, verifyCardImageBytes, validateCardMediaRecord, enumerateReferencedCardMedia,
  encodeCardImageBase64, decodeCardImageBase64, MAX_CARD_IMAGE_BYTES,
} from '../lib/card-media.js';
import { CardImageStore } from '../electron/card-images.js';
import { syntheticPng, syntheticJpeg, syntheticWebp } from './helpers/card-images.js';

test('PNG, JPEG and WebP magic determines type, bounded dimensions and SHA-256 address', async () => {
  for (const [bytes, mimeType, extension] of [[syntheticPng(), 'image/png', 'png'], [syntheticJpeg(), 'image/jpeg', 'jpg'], [syntheticWebp(), 'image/webp', 'webp']]) {
    const metadata = await analyzeCardImage(bytes);
    assert.equal(metadata.mimeType, mimeType);
    assert.equal(metadata.id, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(metadata.fileName, `${metadata.id}.${extension}`);
    assert.equal(metadata.byteLength, bytes.length);
    assert.equal(metadata.width, 1);
    assert.equal(metadata.height, 1);
    assert.deepEqual(await verifyCardImageBytes(bytes, metadata), metadata);
    assert.deepEqual(decodeCardImageBase64(encodeCardImageBase64(bytes)), bytes);
  }
});

test('unsupported types, malformed payloads, oversized bytes and decompression-bomb dimensions are rejected', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3]), new TextEncoder().encode('<svg/>'), new TextEncoder().encode('GIF89a'), new Uint8Array(MAX_CARD_IMAGE_BYTES + 1)]) {
    await assert.rejects(analyzeCardImage(bytes), /image|PNG|byte/i);
  }
  await assert.rejects(analyzeCardImage(syntheticPng({ width: 20_001 })), { code: 'IMAGE_DIMENSIONS' });
  await assert.rejects(analyzeCardImage(syntheticPng({ width: 8000, height: 8000 })), { code: 'IMAGE_DIMENSIONS' });
  await assert.rejects(analyzeCardImage(syntheticPng({ width: 0 })), { code: 'IMAGE_DIMENSIONS' });
  await assert.rejects(analyzeCardImage(syntheticJpeg(0)), { code: 'IMAGE_DIMENSIONS' });
  const png = syntheticPng();
  png[20] ^= 1;
  await assert.rejects(analyzeCardImage(png), /checksum/);
  await assert.rejects(analyzeCardImage(syntheticJpeg().slice(0, -2)), /incomplete/);
  const webp = syntheticWebp();
  webp[4] += 1;
  await assert.rejects(analyzeCardImage(webp), /length/);
});

test('metadata and base64 reject injected paths, wrong hashes, unsafe types, malformed encodings and huge input', async () => {
  const bytes = syntheticPng();
  const record = await analyzeCardImage(bytes);
  for (const change of [{ id: '../outside' }, { fileName: '../outside.png' }, { mimeType: 'image/svg+xml' }, { mimeType: {} }, { width: Infinity }, { byteLength: -1 }]) {
    assert.throws(() => validateCardMediaRecord({ ...record, ...change }), /image|Card/i);
  }
  await assert.rejects(verifyCardImageBytes(bytes, { ...record, id: 'a'.repeat(64), fileName: `${'a'.repeat(64)}.png` }), /content hash/);
  for (const encoded of ['', 'a', 'AAAA===', 'AA=A', '!!!!', 'A===', 'AAAA AA==']) assert.throws(() => decodeCardImageBase64(encoded), /encoding/);
  assert.throws(() => decodeCardImageBase64('A'.repeat(Math.ceil(MAX_CARD_IMAGE_BYTES / 3) * 4 + 1025)), /safety limit/);
  assert.deepEqual(decodeCardImageBase64(`${encodeCardImageBase64(bytes).slice(0, 8)}\n${encodeCardImageBase64(bytes).slice(8)}`), bytes);
});

test('only live card face and occlusion references create media dependencies; shared files deduplicate', async () => {
  const first = await analyzeCardImage(syntheticPng());
  const unused = await analyzeCardImage(syntheticPng({ color: [1, 1, 1, 255] }));
  const workspace = { media: [first, unused], cards: [
    { questionImages: [{ mediaId: first.id, description: 'رسم Graph' }], answerImages: [{ mediaId: first.id, description: '' }] },
    { occlusion: { mediaId: first.id } },
  ] };
  assert.deepEqual(enumerateReferencedCardMedia(workspace), [first]);
  workspace.cards = [];
  assert.deepEqual(enumerateReferencedCardMedia(workspace), []);
  workspace.cards = [{ questionImages: [{ mediaId: 'b'.repeat(64), description: '' }] }];
  assert.throws(() => enumerateReferencedCardMedia(workspace), /missing/);
});

test('native content-addressed storage survives restart, deduplicates, repairs interrupted metadata writes and preserves corruption', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recall-card-images-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new CardImageStore(directory);
  const bytes = syntheticPng();
  const metadata = await store.save(bytes);
  assert.deepEqual(await store.save(bytes), metadata);
  assert.equal((await readdir(directory)).length, 2);
  const restarted = new CardImageStore(directory);
  assert.deepEqual((await restarted.read(metadata.id)).bytes, bytes);
  await unlink(path.join(directory, `${metadata.id}.json`));
  await assert.rejects(restarted.read(metadata.id), { code: 'LOCAL_IMAGE_MISSING' });
  assert.deepEqual(await restarted.save(bytes), metadata);
  assert.deepEqual((await restarted.read(metadata.id)).bytes, bytes);
  await assert.rejects(restarted.read('../other'), { code: 'INVALID_MEDIA' });
  const corrupted = new Uint8Array(bytes);
  corrupted[20] ^= 1;
  await writeFile(path.join(directory, metadata.fileName), corrupted);
  await assert.rejects(restarted.read(metadata.id), /checksum/);
  await assert.rejects(restarted.save(bytes), /checksum/);
  assert.deepEqual(new Uint8Array(await readFile(path.join(directory, metadata.fileName))), corrupted);
});
