const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets');
const PACK = path.join(OUT_DIR, 'bee-character-pack.png');
const W = 96;
const H = 72;

const states = {
  fly: { col: 3, row: 1, delay: 14, shifts: [0, -2, 0, 1] }, // H: Auto
  read: { col: 3, row: 2, delay: 32, shifts: [0, -1, 0, -1] }, // L: Manual
  sleep: { col: 1, row: 0, delay: 45, shifts: [0, 1, 0, 1] } // B: OFF
};

function readUInt32(buf, offset) {
  return buf.readUInt32BE(offset);
}

function parsePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buf.length) {
    const length = readUInt32(buf, offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  let rawOffset = 0;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    cur.fill(0);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? cur[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      const value = raw[rawOffset++];
      if (filter === 0) cur[x] = value;
      else if (filter === 1) cur[x] = (value + left) & 255;
      else if (filter === 2) cur[x] = (value + up) & 255;
      else if (filter === 3) cur[x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) cur[x] = (value + paeth(left, up, upLeft)) & 255;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = cur[src];
      rgba[dst + 1] = cur[src + 1];
      rgba[dst + 2] = cur[src + 2];
      rgba[dst + 3] = channels === 4 ? cur[src + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }

  return { width, height, rgba };
}

function isKey(r, g, b, a) {
  return a < 10 || (r > 210 && g < 90 && b > 210);
}

function buildPalette() {
  const palette = [[0, 0, 0]];
  const levels = [0, 51, 102, 153, 204, 255];
  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) palette.push([r, g, b]);
    }
  }
  for (let i = 0; i < 39; i++) {
    const v = Math.round((i / 38) * 255);
    palette.push([v, v, v]);
  }
  return palette.slice(0, 256);
}

const palette = buildPalette();
const nearestCache = new Map();

function nearestIndex(r, g, b) {
  const key = `${r},${g},${b}`;
  if (nearestCache.has(key)) return nearestCache.get(key);

  let best = 1;
  let bestDistance = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  nearestCache.set(key, best);
  return best;
}

function extractCharacter(sheet, col, row) {
  const cellW = Math.floor(sheet.width / 4);
  const cellH = Math.floor(sheet.height / 3);
  const x0 = col * cellW;
  const y0 = row * cellH;
  const x1 = col === 3 ? sheet.width : (col + 1) * cellW;
  const y1 = row === 2 ? sheet.height : (row + 1) * cellH;
  const scanY0 = y0 + Math.floor(cellH * 0.28);

  let minX = x1;
  let minY = y1;
  let maxX = x0;
  let maxY = scanY0;

  for (let y = scanY0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * sheet.width + x) * 4;
      if (!isKey(sheet.rgba[p], sheet.rgba[p + 1], sheet.rgba[p + 2], sheet.rgba[p + 3])) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  minX = Math.max(x0, minX - 12);
  minY = Math.max(scanY0, minY - 12);
  maxX = Math.min(x1 - 1, maxX + 12);
  maxY = Math.min(y1 - 1, maxY + 12);

  return { minX, minY, srcW: maxX - minX + 1, srcH: maxY - minY + 1 };
}

function renderFrame(sheet, character, yShift) {
  const scale = Math.min(88 / character.srcW, 64 / character.srcH);
  const dstW = Math.max(1, Math.round(character.srcW * scale));
  const dstH = Math.max(1, Math.round(character.srcH * scale));
  const offX = Math.floor((W - dstW) / 2);
  const offY = Math.floor((H - dstH) / 2) + yShift;
  const out = new Uint8Array(W * H);

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const dy = offY + y;
      const dx = offX + x;
      if (dx < 0 || dx >= W || dy < 0 || dy >= H) continue;
      const sx = character.minX + Math.min(character.srcW - 1, Math.floor(x / scale));
      const sy = character.minY + Math.min(character.srcH - 1, Math.floor(y / scale));
      const p = (sy * sheet.width + sx) * 4;
      const r = sheet.rgba[p];
      const g = sheet.rgba[p + 1];
      const b = sheet.rgba[p + 2];
      const a = sheet.rgba[p + 3];
      out[dy * W + dx] = isKey(r, g, b, a) ? 0 : nearestIndex(r, g, b);
    }
  }

  return out;
}

function wordBytes(s) {
  return Array.from(Buffer.from(s, 'ascii'));
}

function u16(n) {
  return [n & 255, (n >> 8) & 255];
}

function bitWriter() {
  const bytes = [];
  let cur = 0;
  let bits = 0;
  return {
    write(code, size) {
      cur |= code << bits;
      bits += size;
      while (bits >= 8) {
        bytes.push(cur & 255);
        cur >>= 8;
        bits -= 8;
      }
    },
    finish() {
      if (bits > 0) bytes.push(cur & 255);
      return bytes;
    }
  };
}

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const size = minCodeSize + 1;
  const bw = bitWriter();
  bw.write(clear, size);
  let literalCount = 0;
  const maxLiteralsBeforeClear = (1 << size) - (end + 2);
  for (const k of indices) {
    if (literalCount >= maxLiteralsBeforeClear) {
      bw.write(clear, size);
      literalCount = 0;
    }
    bw.write(k, size);
    literalCount++;
  }
  bw.write(end, size);
  return bw.finish();
}

function subBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const part = data.slice(i, i + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
  return out;
}

function gif(frames, delay) {
  const out = [];
  out.push(...wordBytes('GIF89a'));
  out.push(...u16(W), ...u16(H), 0xf7, 0, 0);
  for (const rgb of palette) out.push(...rgb);
  out.push(0x21, 0xff, 0x0b, ...wordBytes('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, 0x09, ...u16(delay), 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(W), ...u16(H), 0);
    out.push(8);
    out.push(...subBlocks(lzw(frame, 8)));
  }
  out.push(0x3b);
  return Buffer.from(out);
}

const sheet = parsePng(PACK);

for (const [kind, state] of Object.entries(states)) {
  const character = extractCharacter(sheet, state.col, state.row);
  const frames = state.shifts.map((shift) => renderFrame(sheet, character, shift));
  const filename = kind === 'fly' ? 'bee_fly.gif' : kind === 'read' ? 'bee_read.gif' : 'bee_sleep.gif';
  fs.writeFileSync(path.join(OUT_DIR, filename), gif(frames, state.delay));
}
