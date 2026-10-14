import { validateWorkspaceDocument, serializeWorkspaceDocument, MAX_WORKSPACE_BYTES } from './workspace.js';
import { analyzeCardImage, enumerateReferencedCardMedia } from './card-media.js';

export const MAX_FULL_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5001;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function bytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('The full backup must contain ZIP bytes.');
}
function allowedPath(name) {
  return name === 'workspace.json' || /^media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(name);
}
function headers(size) { const value = new Uint8Array(size); return { value, view: new DataView(value.buffer) }; }
function join(parts, size) {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

// Stored (uncompressed) ZIP keeps both environments independent of compression
// libraries and eliminates zip-bomb expansion. Standard ZIP readers support it.
function encodeZip(entries) {
  if (entries.length > MAX_ENTRIES) throw new Error('The backup contains too many images.');
  const local = [], central = [];
  let offset = 0;
  let centralBytes = 0;
  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name), crc = crc32(data);
    const header = headers(30);
    header.view.setUint32(0, 0x04034b50, true);
    header.view.setUint16(4, 20, true); header.view.setUint16(6, 0x800, true);
    header.view.setUint16(12, 0x21, true); // Valid neutral DOS date: 1980-01-01, not an activity timestamp.
    header.view.setUint32(14, crc, true); header.view.setUint32(18, data.byteLength, true); header.view.setUint32(22, data.byteLength, true);
    header.view.setUint16(26, nameBytes.byteLength, true);
    local.push(header.value, nameBytes, data);
    const directory = headers(46);
    directory.view.setUint32(0, 0x02014b50, true); directory.view.setUint16(4, 20, true); directory.view.setUint16(6, 20, true); directory.view.setUint16(8, 0x800, true);
    directory.view.setUint16(14, 0x21, true);
    directory.view.setUint32(16, crc, true); directory.view.setUint32(20, data.byteLength, true); directory.view.setUint32(24, data.byteLength, true);
    directory.view.setUint16(28, nameBytes.byteLength, true); directory.view.setUint32(42, offset, true);
    central.push(directory.value, nameBytes); centralBytes += 46 + nameBytes.byteLength;
    offset += 30 + nameBytes.byteLength + data.byteLength;
    if (offset + centralBytes + 22 > MAX_FULL_BACKUP_BYTES) throw new Error('The full backup exceeds the 64 MiB portable-backup limit.');
  }
  const end = headers(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, entries.length, true); end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralBytes, true); end.view.setUint32(16, offset, true);
  return join([...local, ...central, end.value], offset + centralBytes + 22);
}

function decodeZip(input) {
  const data = bytes(input);
  if (data.byteLength > MAX_FULL_BACKUP_BYTES || data.byteLength < 22) throw new Error('The full backup is invalid or exceeds 64 MiB.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.byteLength - 22;
  if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('Use a complete, single-file Recall Labs ZIP backup.');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true);
  if (!count || count > MAX_ENTRIES || view.getUint16(end + 8, true) !== count || directoryOffset + directorySize !== end) throw new Error('The backup ZIP directory is invalid.');
  const result = new Map();
  let directory = directoryOffset;
  let expectedLocalOffset = 0;
  for (let index = 0; index < count; index++) {
    if (directory + 46 > end || view.getUint32(directory, true) !== 0x02014b50) throw new Error('The backup ZIP directory is truncated.');
    const flag = view.getUint16(directory + 8, true), method = view.getUint16(directory + 10, true), crc = view.getUint32(directory + 16, true), size = view.getUint32(directory + 24, true);
    const nameSize = view.getUint16(directory + 28, true), extraSize = view.getUint16(directory + 30, true), commentSize = view.getUint16(directory + 32, true), offset = view.getUint32(directory + 42, true);
    if (![0, 0x800].includes(flag) || method !== 0 || view.getUint32(directory + 20, true) !== size || extraSize !== 0 || commentSize !== 0 || view.getUint16(directory + 34, true) !== 0 || offset !== expectedLocalOffset) throw new Error('The backup uses unsupported ZIP compression, encryption, or paths.');
    if (!nameSize || nameSize > 100 || directory + 46 + nameSize > end) throw new Error('The backup filename is invalid.');
    let name;
    try { name = decoder.decode(data.subarray(directory + 46, directory + 46 + nameSize)); }
    catch { throw new Error('The backup filename is invalid.'); }
    if (!allowedPath(name) || result.has(name)) throw new Error('The backup contains an unsafe, duplicate, or unsupported filename.');
    if (offset + 30 + nameSize + size > directoryOffset || view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flag || view.getUint16(offset + 8, true) !== method || view.getUint32(offset + 14, true) !== crc || view.getUint32(offset + 18, true) !== size || view.getUint32(offset + 22, true) !== size || view.getUint16(offset + 26, true) !== nameSize || view.getUint16(offset + 28, true) !== 0) throw new Error('The backup ZIP entry is invalid.');
    const localName = data.subarray(offset + 30, offset + 30 + nameSize);
    if (decoder.decode(localName) !== name) throw new Error('The backup ZIP filenames disagree.');
    const contents = data.subarray(offset + 30 + nameSize, offset + 30 + nameSize + size);
    if (crc32(contents) !== crc) throw new Error('The backup ZIP checksum failed.');
    if ((name === 'workspace.json' && size > MAX_WORKSPACE_BYTES) || (name !== 'workspace.json' && size > 10 * 1024 * 1024)) throw new Error('A backup entry exceeds its size limit.');
    result.set(name, contents);
    expectedLocalOffset = offset + 30 + nameSize + size;
    directory += 46 + nameSize;
  }
  if (directory !== end || expectedLocalOffset !== directoryOffset || !result.has('workspace.json')) throw new Error('The backup ZIP contents are incomplete.');
  return result;
}

const matchingMetadata = (left, right) => ['id', 'fileName', 'mimeType', 'byteLength', 'width', 'height'].every((key) => left[key] === right[key]);

export async function createFullWorkspaceBackup(input, store) {
  const document = validateWorkspaceDocument(input);
  const entries = [{ name: 'workspace.json', data: encoder.encode(serializeWorkspaceDocument(document)) }];
  const mediaRecords = enumerateReferencedCardMedia(document.workspace);
  for (const record of mediaRecords) {
    let image;
    try { image = await store.read(record.id); }
    catch { throw new Error(`The image ${record.id.slice(0, 12)} is missing on this device. Sync or re-import that image before creating a complete backup.`); }
    const content = bytes(image.bytes);
    const analyzed = await analyzeCardImage(content);
    if (!matchingMetadata(analyzed, record)) throw new Error('A local card image does not match the workspace metadata. Re-import the image before exporting.');
    entries.push({ name: `media/${record.fileName}`, data: content });
  }
  return { bytes: encodeZip(entries), images: mediaRecords.length, complete: true };
}

/** Validate every record, path, checksum, and image before the caller writes. */
export async function parseFullWorkspaceBackup(input) {
  const entries = decodeZip(input);
  let parsed;
  try { parsed = JSON.parse(decoder.decode(entries.get('workspace.json'))); }
  catch { throw new Error('The backup workspace is not valid UTF-8 JSON.'); }
  const document = validateWorkspaceDocument(parsed);
  const mediaRecords = enumerateReferencedCardMedia(document.workspace);
  const images = [];
  for (const record of mediaRecords) {
    const content = entries.get(`media/${record.fileName}`);
    if (!content) throw new Error('The backup is missing a referenced card image. No workspace records have been imported.');
    const analyzed = await analyzeCardImage(content);
    if (!matchingMetadata(analyzed, record)) throw new Error('The backup card image hash or metadata does not match. No workspace records have been imported.');
    images.push({ ...analyzed, bytes: content.slice() });
  }
  if (entries.size !== images.length + 1) throw new Error('The backup contains unreferenced or unexpected image files.');
  return { document, images, complete: true };
}
