const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_THUMBNAIL_EDGE = 512;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function parsePng(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  let offset = 8;
  let header = null;
  const idatChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return null;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!header || idatChunks.length === 0) return null;
  if (header.bitDepth !== 8 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) return null;
  if (![2, 6].includes(header.colorType)) return null;
  return { ...header, compressed: Buffer.concat(idatChunks) };
}

function decodePixels(parsed) {
  const bpp = parsed.colorType === 6 ? 4 : 3;
  const rowBytes = parsed.width * bpp;
  const inflated = zlib.inflateSync(parsed.compressed);
  const expected = (rowBytes + 1) * parsed.height;
  if (inflated.length < expected) return null;

  const rows = [];
  let offset = 0;
  let prev = Buffer.alloc(rowBytes);

  for (let y = 0; y < parsed.height; y += 1) {
    const filter = inflated[offset];
    const raw = inflated.subarray(offset + 1, offset + 1 + rowBytes);
    const row = Buffer.alloc(rowBytes);

    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= bpp ? prev[x - bpp] || 0 : 0;
      let value = raw[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) value = (value + paethPredictor(left, up, upLeft)) & 0xff;
      else if (filter !== 0) return null;
      row[x] = value;
    }

    rows.push(row);
    prev = row;
    offset += rowBytes + 1;
  }

  return { rows, bpp };
}

function encodeRgbaPng(width, height, rgba) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (rowBytes + 1);
    raw[targetOffset] = 0;
    rgba.copy(raw, targetOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', zlib.deflateSync(raw, { level: 8 })),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createPngThumbnail(buffer, maxEdge = MAX_THUMBNAIL_EDGE) {
  const parsed = parsePng(buffer);
  if (!parsed) return null;

  const scale = Math.min(1, maxEdge / Math.max(parsed.width, parsed.height));
  if (scale >= 1) return null;

  const decoded = decodePixels(parsed);
  if (!decoded) return null;

  const targetWidth = Math.max(1, Math.round(parsed.width * scale));
  const targetHeight = Math.max(1, Math.round(parsed.height * scale));
  const rgba = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(parsed.height - 1, Math.floor(y / scale));
    const sourceRow = decoded.rows[sourceY];
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(parsed.width - 1, Math.floor(x / scale));
      const sourceOffset = sourceX * decoded.bpp;
      const targetOffset = (y * targetWidth + x) * 4;
      rgba[targetOffset] = sourceRow[sourceOffset];
      rgba[targetOffset + 1] = sourceRow[sourceOffset + 1];
      rgba[targetOffset + 2] = sourceRow[sourceOffset + 2];
      rgba[targetOffset + 3] = decoded.bpp === 4 ? sourceRow[sourceOffset + 3] : 255;
    }
  }

  return encodeRgbaPng(targetWidth, targetHeight, rgba);
}

module.exports = { createPngThumbnail };
