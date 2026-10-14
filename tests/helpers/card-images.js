import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  body.copy(output, 4);
  output.writeUInt32BE(crc32(body), output.length - 4);
  return output;
}

/** Synthetic one-pixel PNG; header overrides exercise dimension validation. */
export function syntheticPng({ color = [20, 30, 40, 255], width = 1, height = 1, paddingBytes = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), ...(paddingBytes ? [pngChunk('tEXt', Buffer.concat([Buffer.from('fixture\0'), Buffer.alloc(paddingBytes, 65)]))] : []),
    pngChunk('IDAT', deflateSync(Buffer.from([0, ...color]))), pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

/** Header-level fixture; actual browser tests exercise decoder-rendered images. */
export function syntheticJpeg(width = 1, height = 1) {
  const frame = Buffer.from([255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return new Uint8Array(Buffer.concat([Buffer.from([255, 216]), frame, Buffer.from([255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217])]));
}

export function jpegWithOrientation(input, orientation = 6) {
  const payload = Buffer.alloc(32);
  payload.write('Exif\0\0', 0, 'binary'); payload.write('II', 6);
  payload.writeUInt16LE(42, 8); payload.writeUInt32LE(8, 10);
  payload.writeUInt16LE(1, 14); payload.writeUInt16LE(0x112, 16);
  payload.writeUInt16LE(3, 18); payload.writeUInt32LE(1, 20); payload.writeUInt16LE(orientation, 24);
  const marker = Buffer.alloc(4); marker[0] = 255; marker[1] = 225; marker.writeUInt16BE(payload.length + 2, 2);
  return new Uint8Array(Buffer.concat([Buffer.from(input).subarray(0, 2), marker, payload, Buffer.from(input).subarray(2)]));
}

export function syntheticWebp(width = 1, height = 1) {
  const output = Buffer.alloc(26);
  output.write('RIFF', 0);
  output.writeUInt32LE(18, 4);
  output.write('WEBPVP8L', 8);
  output.writeUInt32LE(5, 16);
  output[20] = 0x2f;
  output.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return new Uint8Array(output);
}
