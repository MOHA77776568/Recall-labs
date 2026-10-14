import { mkdir, readFile, open, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeCardImage, cardImageBytes, validateCardMediaRecord, verifyCardImageBytes, CardMediaError, MAX_CARD_IMAGE_BYTES } from '../lib/card-media.js';

const ID = /^[a-f0-9]{64}$/;

async function atomicWrite(filename, input) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(input);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filename);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function regularSize(filename, maximum) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum) throw new CardMediaError('LOCAL_IMAGE_INVALID', 'A locally stored card image has an unsupported file size or type.');
  return info.size;
}

/** Private, immutable, content-addressed image storage. Removing a card never deletes shared bytes. */
export class CardImageStore {
  constructor(directory) { this.directory = directory; }

  async save(input) {
    const bytes = cardImageBytes(input);
    const metadata = await analyzeCardImage(bytes);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const existing = await this.read(metadata.id);
      await verifyCardImageBytes(existing.bytes, metadata);
      return metadata;
    } catch (error) {
      if (error.code !== 'LOCAL_IMAGE_MISSING') throw error;
    }
    const binaryPath = path.join(this.directory, metadata.fileName);
    // A crash between binary and metadata writes is repairable without losing bytes.
    try {
      await regularSize(binaryPath, MAX_CARD_IMAGE_BYTES);
      await verifyCardImageBytes(new Uint8Array(await readFile(binaryPath)), metadata);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicWrite(binaryPath, bytes);
    }
    await atomicWrite(path.join(this.directory, `${metadata.id}.json`), `${JSON.stringify(metadata)}\n`);
    if (process.platform !== 'win32') {
      const handle = await open(this.directory, 'r');
      try { await handle.sync().catch(() => {}); } finally { await handle.close(); }
    }
    return metadata;
  }

  async read(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new CardMediaError('INVALID_MEDIA', 'Invalid card image ID.');
    let metadata;
    let bytes;
    try {
      const metadataPath = path.join(this.directory, `${id}.json`);
      await regularSize(metadataPath, 2048);
      metadata = validateCardMediaRecord(JSON.parse(await readFile(metadataPath, 'utf8')));
      if (metadata.id !== id) throw new CardMediaError('LOCAL_IMAGE_INVALID', 'Local card image metadata has the wrong content hash.');
      const binaryPath = path.join(this.directory, metadata.fileName);
      const size = await regularSize(binaryPath, MAX_CARD_IMAGE_BYTES);
      if (size !== metadata.byteLength) throw new CardMediaError('LOCAL_IMAGE_INVALID', 'The locally stored card image has an invalid length.');
      bytes = new Uint8Array(await readFile(binaryPath));
      await verifyCardImageBytes(bytes, metadata);
    } catch (error) {
      if (error.code === 'ENOENT') throw new CardMediaError('LOCAL_IMAGE_MISSING', 'This card image is not stored on this device. Sync to download it, or restore a full backup.');
      if (error instanceof CardMediaError) throw error;
      throw new CardMediaError('LOCAL_IMAGE_INVALID', 'The locally stored card image could not be read. Existing files were preserved.');
    }
    return { ...metadata, bytes };
  }

  async has(id) {
    try { await this.read(id); return true; }
    catch (error) { if (error.code === 'LOCAL_IMAGE_MISSING') return false; throw error; }
  }
}
