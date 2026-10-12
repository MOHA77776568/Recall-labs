import { mkdir, readFile, open, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TYPES = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.srt': 'text/plain', '.vtt': 'text/vtt' };

async function writeDurable(filename, bytes) {
  const handle = await open(filename, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

export class AttachmentStore {
  constructor(directory) { this.directory = directory; }

  async save(input) {
    if (!input || typeof input !== 'object' || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || /[\/\\\u0000-\u001f\u007f]/.test(input.name)) throw new Error('A valid source filename is required.');
    const mimeType = TYPES[path.extname(input.name).toLowerCase()];
    if (!mimeType) throw new Error('Source files must be PDF, TXT, MD, SRT, or VTT.');
    const bytes = input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : input.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error('A source file must contain between 1 byte and 15 MB.');
    const id = randomUUID();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const binary = path.join(this.directory, `${id}.bin`);
    const temporary = path.join(this.directory, `.${id}.tmp`);
    const metadataPath = path.join(this.directory, `${id}.json`);
    const temporaryMetadata = path.join(this.directory, `.${id}.json.tmp`);
    try {
      await writeDurable(temporary, bytes);
      await rename(temporary, binary);
      await writeDurable(temporaryMetadata, `${JSON.stringify({ id, name: input.name, mimeType, size: bytes.byteLength })}\n`);
      await rename(temporaryMetadata, metadataPath);
      if (process.platform !== 'win32') {
        const handle = await open(this.directory, 'r');
        try { await handle.sync().catch(() => {}); } finally { await handle.close(); }
      }
    } catch (error) {
      await unlink(temporary).catch(() => {});
      await unlink(temporaryMetadata).catch(() => {});
      await unlink(binary).catch(() => {});
      await unlink(metadataPath).catch(() => {});
      throw error;
    }
    return { id, name: input.name };
  }

  async read(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid local source file ID.');
    let metadata;
    let bytes;
    try {
      const [metadataSize, binarySize] = await Promise.all([stat(path.join(this.directory, `${id}.json`)), stat(path.join(this.directory, `${id}.bin`))]);
      if (metadataSize.size > 4096 || !binarySize.size || binarySize.size > MAX_FILE_BYTES) throw new Error('Unsupported local source file size.');
      metadata = JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8'));
      bytes = await readFile(path.join(this.directory, `${id}.bin`));
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('This source file is not stored on this device. Reattach the original file; GitHub sync includes study data but not attachments.');
      throw new Error('The local source file could not be read. Existing files were preserved.');
    }
    if (metadata.id !== id || typeof metadata.name !== 'string' || !TYPES[path.extname(metadata.name).toLowerCase()] || metadata.mimeType !== TYPES[path.extname(metadata.name).toLowerCase()] || metadata.size !== bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('The local source file has invalid metadata.');
    return { name: metadata.name, mimeType: metadata.mimeType, bytes: new Uint8Array(bytes) };
  }
}
