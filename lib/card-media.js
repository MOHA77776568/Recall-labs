export const MAX_CARD_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CARD_IMAGE_PIXELS = 40_000_000;
export const MAX_CARD_IMAGE_DIMENSION = 20_000;
const MEDIA_ID = /^[a-f0-9]{64}$/;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export class CardMediaError extends Error {
  constructor(code, message) { super(message); this.name = 'CardMediaError'; this.code = code; }
}
const fail = (code, message) => { throw new CardMediaError(code, message); };

/** Copy before hashing or writing so a caller cannot change the captured bytes. */
export function cardImageBytes(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_CARD_IMAGE_BYTES) {
    fail('IMAGE_SIZE', 'A card image must contain between 1 byte and 10 MB.');
  }
  return new Uint8Array(bytes);
}

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width > MAX_CARD_IMAGE_DIMENSION || height > MAX_CARD_IMAGE_DIMENSION || width * height > MAX_CARD_IMAGE_PIXELS) {
    fail('IMAGE_DIMENSIONS', 'Card images must be at most 20,000 pixels on either side and 40 million pixels in total.');
  }
  return { width, height };
}

export function validateCardMediaRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('INVALID_MEDIA', 'Card image metadata must be an object.');
  if (typeof input.id !== 'string' || !MEDIA_ID.test(input.id)) fail('INVALID_MEDIA', 'Card image ID must be a SHA-256 content hash.');
  if (typeof input.mimeType !== 'string' || !Object.hasOwn(EXTENSIONS, input.mimeType)) fail('INVALID_MEDIA', 'Card images support PNG, JPEG, and WebP only.');
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > MAX_CARD_IMAGE_BYTES) fail('IMAGE_SIZE', 'Card image byte length is invalid.');
  dimensions(input.width, input.height);
  const fileName = `${input.id}.${EXTENSIONS[input.mimeType]}`;
  if (input.fileName !== fileName) fail('INVALID_MEDIA', 'Card image filenames must match their content hash and image type.');
  return { id: input.id, mimeType: input.mimeType, byteLength: input.byteLength, width: input.width, height: input.height, fileName };
}

function ascii(bytes, offset, length) { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
// Honor the original file's display orientation without rewriting its bytes.
// Relative masks are drawn over the browser's oriented image, not raw sensor dimensions.
function exifOrientation(bytes, start, length) {
  if (ascii(bytes, start, 6) === 'Exif\0\0') { start += 6; length -= 6; }
  if (length < 8) return 1;
  const order = ascii(bytes, start, 2);
  if (!['II', 'MM'].includes(order)) return 1;
  const little = order === 'II'; const view = new DataView(bytes.buffer, bytes.byteOffset + start, length);
  if (view.getUint16(2, little) !== 42) return 1;
  const directory = view.getUint32(4, little);
  if (directory < 8 || directory > length - 2) return 1;
  const count = view.getUint16(directory, little);
  if (count > 256 || directory + 2 + count * 12 > length) return 1;
  for (let index = 0; index < count; index++) {
    const at = directory + 2 + index * 12;
    if (view.getUint16(at, little) === 0x112 && view.getUint16(at + 2, little) === 3 && view.getUint32(at + 4, little) === 1) {
      const value = view.getUint16(at + 8, little); return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
const oriented = (size, orientation) => orientation >= 5 && orientation <= 8 ? { width: size.height, height: size.width } : size;
function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let result;
  let dataSeen = false;
  let endSeen = false;
  let orientation = 1;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail('INVALID_IMAGE', 'The PNG image has an invalid chunk.');
    if (view.getUint32(end - 4) !== crc32(bytes, offset + 4, end - 4)) fail('INVALID_IMAGE', 'The PNG image checksum is invalid.');
    if (!result) {
      if (type !== 'IHDR' || length !== 13) fail('INVALID_IMAGE', 'The PNG image header is missing.');
      result = dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12));
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) fail('INVALID_IMAGE', 'The PNG image header is unsupported.');
    } else if (type === 'IHDR') fail('INVALID_IMAGE', 'The PNG image has duplicate headers.');
    if (type === 'acTL') fail('INVALID_IMAGE', 'Use a static PNG image instead of an animated PNG.');
    if (type === 'eXIf') orientation = exifOrientation(bytes, offset + 8, length);
    if (type === 'IDAT') dataSeen = true;
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) fail('INVALID_IMAGE', 'The PNG image ending is invalid.');
      endSeen = true;
      break;
    }
    offset = end;
  }
  if (!result || !dataSeen || !endSeen) fail('INVALID_IMAGE', 'The PNG image is incomplete.');
  return oriented(result, orientation);
}

function jpegDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let result;
  let scanSeen = false;
  let orientation = 1;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail('INVALID_IMAGE', 'The JPEG image has an invalid marker.');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!result || !scanSeen || offset !== bytes.length) fail('INVALID_IMAGE', 'The JPEG image is incomplete.');
      return oriented(result, orientation);
    }
    if (marker === 0xd8 || marker === 0x00 || marker === undefined || (marker >= 0xd0 && marker <= 0xd7)) fail('INVALID_IMAGE', 'The JPEG image has an unexpected marker.');
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) fail('INVALID_IMAGE', 'The JPEG image is incomplete.');
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) fail('INVALID_IMAGE', 'The JPEG image has an invalid segment.');
    if (marker === 0xe1 && length >= 8 && ascii(bytes, offset + 2, 6) === 'Exif\0\0') orientation = exifOrientation(bytes, offset + 2, length - 2);
    if (sofMarkers.has(marker)) {
      if (length < 8 || length !== 8 + 3 * bytes[offset + 7]) fail('INVALID_IMAGE', 'The JPEG image frame header is invalid.');
      const parsed = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      if (result && (result.width !== parsed.width || result.height !== parsed.height)) fail('INVALID_IMAGE', 'The JPEG image has inconsistent frames.');
      result = parsed;
    }
    offset += length;
    if (marker === 0xda) {
      scanSeen = true;
      // Entropy data escapes FF as FF00; restart markers remain in this scan.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        let markerOffset = offset + 1;
        while (bytes[markerOffset] === 0xff) markerOffset += 1;
        const next = bytes[markerOffset];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset = markerOffset + 1; continue; }
        break;
      }
    }
  }
  fail('INVALID_IMAGE', 'The JPEG image is incomplete.');
}

function webpDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) fail('INVALID_IMAGE', 'The WebP image length is invalid.');
  let offset = 12;
  let extended;
  let result;
  let orientation = 1;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    const end = data + length;
    if (end > bytes.length) fail('INVALID_IMAGE', 'The WebP image has an invalid chunk.');
    if (type === 'ANIM' || type === 'ANMF') fail('INVALID_IMAGE', 'Use a static WebP image instead of an animated WebP.');
    if (type === 'EXIF') orientation = exifOrientation(bytes, data, length);
    if (type === 'VP8X') {
      if (length !== 10 || extended || (bytes[data] & 0x02)) fail('INVALID_IMAGE', 'The WebP image header is unsupported.');
      const uint24 = (at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      extended = dimensions(uint24(data + 4) + 1, uint24(data + 7) + 1);
    } else if (type === 'VP8 ') {
      if (result || length < 10 || (bytes[data] & 1) || ascii(bytes, data + 3, 3) !== '\x9d\x01\x2a') fail('INVALID_IMAGE', 'The WebP image frame is invalid.');
      result = dimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
    } else if (type === 'VP8L') {
      if (result || length < 5 || bytes[data] !== 0x2f) fail('INVALID_IMAGE', 'The WebP image frame is invalid.');
      const bits = view.getUint32(data + 1, true);
      if (bits >>> 29) fail('INVALID_IMAGE', 'The WebP image version is unsupported.');
      result = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    offset = end + (length & 1);
  }
  if (offset !== bytes.length || !result || (extended && (extended.width !== result.width || extended.height !== result.height))) fail('INVALID_IMAGE', 'The WebP image is incomplete or has inconsistent dimensions.');
  return oriented(result, orientation);
}

/** Strict header/structure validation plus a SHA-256 content address. */
export async function analyzeCardImage(input) {
  const bytes = cardImageBytes(input);
  let mimeType;
  let size;
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') { mimeType = 'image/png'; size = pngDimensions(bytes); }
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) { mimeType = 'image/jpeg'; size = jpegDimensions(bytes); }
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') { mimeType = 'image/webp'; size = webpDimensions(bytes); }
  else fail('IMAGE_TYPE', 'Card images support PNG, JPEG, and WebP only.');
  if (!globalThis.crypto?.subtle) fail('HASH_UNAVAILABLE', 'Secure image hashing is unavailable in this environment.');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const id = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { id, mimeType, byteLength: bytes.length, ...size, fileName: `${id}.${EXTENSIONS[mimeType]}` };
}

export async function verifyCardImageBytes(input, metadata) {
  const expected = validateCardMediaRecord(metadata);
  const actual = await analyzeCardImage(input);
  if (Object.keys(expected).some((key) => expected[key] !== actual[key])) fail('IMAGE_INTEGRITY', 'Card image bytes do not match their recorded content hash or metadata.');
  return actual;
}

export function encodeCardImageBase64(input) {
  const bytes = cardImageBytes(input);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

export function decodeCardImageBase64(encoded) {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_CARD_IMAGE_BYTES / 3) * 4 + 1024) fail('IMAGE_SIZE', 'Encoded card image exceeds the safety limit.');
  const compact = encoded.replace(/[\r\n]/g, '');
  const padding = compact.indexOf('=');
  if (!compact.length || compact.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(compact)
    || (padding !== -1 && !((padding === compact.length - 1) || (padding === compact.length - 2 && compact.endsWith('=='))))) fail('INVALID_IMAGE', 'Card image encoding is invalid.');
  let decoded;
  try { decoded = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0)); }
  catch { fail('INVALID_IMAGE', 'Card image encoding is invalid.'); }
  return cardImageBytes(decoded);
}

/** Only live cards create remote-file dependencies; unused metadata may remain. */
export function enumerateReferencedCardMedia(workspace) {
  const records = new Map((workspace.media ?? []).map((entry) => [entry.id, validateCardMediaRecord(entry)]));
  const ids = new Set();
  for (const card of workspace.cards ?? []) {
    for (const image of [...(card.questionImages ?? []), ...(card.answerImages ?? [])]) ids.add(image.mediaId);
    if (card.occlusion) ids.add(card.occlusion.mediaId);
  }
  return [...ids].sort().map((id) => {
    if (!records.has(id)) fail('MISSING_MEDIA_RECORD', 'A card refers to image metadata that is missing from the workspace.');
    return records.get(id);
  });
}
