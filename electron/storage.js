import { mkdir, open, readFile, rename, copyFile, readdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_STATE_BYTES = 64 * 1024 * 1024;

export class StoreCorruptionError extends Error {
  constructor(filename, cause) {
    super(`The saved library could not be read. It has been preserved at ${filename}. Restore a backup before continuing.`, { cause });
    this.name = 'StoreCorruptionError';
    this.filename = filename;
  }
}

/** One writer owns this store. Existing data is backed up before every replacement. */
export class JsonStore {
  constructor(directory, { backupLimit = 20, validate = (value) => value } = {}) {
    this.directory = directory;
    this.filename = path.join(directory, 'library.json');
    this.backupDirectory = path.join(directory, 'backups');
    this.backupLimit = backupLimit;
    this.validate = validate;
    this.lastBackupTime = 0;
  }

  async load() {
    let contents;
    try {
      contents = await readFile(this.filename);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    try {
      if (contents.byteLength > MAX_STATE_BYTES) throw new Error('Saved state exceeds the supported size.');
      return this.validate(JSON.parse(contents.toString('utf8')));
    } catch (error) {
      throw new StoreCorruptionError(this.filename, error);
    }
  }

  async save(value) {
    this.validate(value);
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error('Saved state exceeds the supported size.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await mkdir(this.backupDirectory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.library-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      const previousBackups = await readdir(this.backupDirectory);
      const newestTime = previousBackups.reduce((maximum, name) => Math.max(maximum, /^\d{16}-/.test(name) ? Number(name.slice(0, 16)) : 0), 0);
      this.lastBackupTime = Math.max(Date.now(), newestTime + 1, this.lastBackupTime + 1);
      const backup = path.join(this.backupDirectory, `${String(this.lastBackupTime).padStart(16, '0')}-${randomUUID()}.json`);
      try {
        await copyFile(this.filename, backup);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await rename(temporary, this.filename);
      // Best-effort directory fsync; Windows does not support opening directories this way.
      if (process.platform !== 'win32') {
        try {
          const directoryHandle = await open(this.directory, 'r');
          try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
        } catch { this.maintenanceWarning = 'The filesystem does not support directory durability checks.'; }
      }
      // A cleanup failure after replacement must not make the caller retry old data.
      await this.pruneBackups().catch(() => { this.maintenanceWarning = 'Some older backups could not be removed.'; });
    } finally {
      if (handle) await handle.close();
      await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async pruneBackups() {
    const backups = (await readdir(this.backupDirectory)).filter((name) => name.endsWith('.json')).sort();
    for (const filename of backups.slice(0, Math.max(0, backups.length - this.backupLimit))) {
      await unlink(path.join(this.backupDirectory, filename));
    }
  }

  async listBackups() {
    let files;
    try { files = await readdir(this.backupDirectory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(files.filter((name) => /^\d{16}-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse().map(async (id) => {
      const details = await stat(path.join(this.backupDirectory, id));
      return { id, createdAt: new Date(Number(id.slice(0, 16))).toISOString(), bytes: details.size };
    }));
  }

  async readBackup(id) {
    if (typeof id !== 'string' || !/^\d{16}-[a-f0-9-]{36}\.json$/.test(id)) throw new Error('Invalid backup ID.');
    const contents = await readFile(path.join(this.backupDirectory, id));
    if (contents.byteLength > MAX_STATE_BYTES) throw new Error('Backup exceeds the supported size.');
    try { return this.validate(JSON.parse(contents.toString('utf8'))); }
    catch (error) { throw new StoreCorruptionError(path.join(this.backupDirectory, id), error); }
  }
}

/** Failed operations release the queue, while concurrent mutations retain their order. */
export class OperationQueue {
  constructor() { this.tail = Promise.resolve(); }

  run(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
}
