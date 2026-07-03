const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets');
const W = 96;
const H = 72;
const S = 3;

const palette = [
  [0, 0, 0],
  [8, 10, 10],
  [255, 221, 42],
  [245, 164, 0],
  [188, 193, 202],
  [255, 255, 255],
  [111, 127, 154],
  [120, 74, 0]
];

function canvas() {
  return new Uint8Array(W * H);
}

function px(img, x, y, c) {
  if (x >= 0 && y >= 0 && x < W && y < H) img[y * W + x] = c;
}

function rect(img, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) px(img, xx, yy, c);
  }
}

function lrect(img, x, y, w, h, c) {
  rect(img, x * S, y * S, w * S, h * S, c);
}

function bee(img, x, y, opts = {}) {
  const wing = opts.wing || 'up';
  const sleep = !!opts.sleep;
  const stripeShift = opts.stripeShift || 0;

  if (sleep) {
    // zzz
    lrect(img, x + 16, y + 0, 3, 1, 6);
    lrect(img, x + 18, y + 1, 1, 1, 6);
    lrect(img, x + 17, y + 2, 3, 1, 6);
    lrect(img, x + 21, y + 3, 2, 1, 6);
    lrect(img, x + 22, y + 4, 1, 1, 6);
    lrect(img, x + 21, y + 5, 3, 1, 6);
  }

  // wing
  if (wing === 'up') {
    lrect(img, x + 13, y + 3, 5, 1, 1);
    lrect(img, x + 12, y + 4, 7, 3, 4);
    lrect(img, x + 13, y + 5, 5, 2, 5);
    lrect(img, x + 18, y + 5, 1, 2, 1);
  } else if (wing === 'down') {
    lrect(img, x + 12, y + 7, 7, 1, 1);
    lrect(img, x + 12, y + 8, 7, 3, 4);
    lrect(img, x + 13, y + 8, 5, 2, 5);
    lrect(img, x + 18, y + 9, 1, 2, 1);
  } else {
    lrect(img, x + 13, y + 6, 6, 1, 1);
    lrect(img, x + 13, y + 7, 6, 2, 4);
    lrect(img, x + 14, y + 7, 4, 1, 5);
  }

  // body outline
  lrect(img, x + 6, y + 9, 2, 5, 1);
  lrect(img, x + 8, y + 7, 12, 2, 1);
  lrect(img, x + 8, y + 14, 12, 2, 1);
  lrect(img, x + 20, y + 9, 3, 5, 1);
  lrect(img, x + 9, y + 9, 11, 5, 2);
  lrect(img, x + 10 + stripeShift, y + 9, 1, 5, 1);
  lrect(img, x + 15 + stripeShift, y + 9, 1, 5, 1);
  lrect(img, x + 19, y + 10, 3, 3, 1);

  // head and eye
  lrect(img, x + 22, y + 10, 3, 4, 1);
  lrect(img, x + 23, y + 11, 1, 1, sleep ? 7 : 5);

  // tail and legs
  lrect(img, x + 4, y + 11, 2, 2, 1);
  lrect(img, x + 10, y + 17, 2, 2, 1);
  lrect(img, x + 15, y + 17, 2, 2, 1);
  lrect(img, x + 20, y + 17, 2, 2, 1);
}

function makeFrame(kind, i) {
  const img = canvas();
  if (kind === 'fly') {
    const bob = [0, -1, 0, 1][i % 4];
    bee(img, 3, 6 + bob, { wing: i % 2 === 0 ? 'up' : 'down', stripeShift: i % 2 });
  } else if (kind === 'idle') {
    bee(img, 3, 8 + (i === 1 ? -1 : 0), { wing: 'idle' });
  } else {
    bee(img, 3, 12, { wing: 'idle', sleep: true });
  }
  return img;
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
  let next = end + 1;
  let size = minCodeSize + 1;
  const maxSize = 12;
  const dict = new Map();
  const reset = () => {
    dict.clear();
    for (let i = 0; i < clear; i++) dict.set(String(i), i);
    next = end + 1;
    size = minCodeSize + 1;
  };
  reset();
  const bw = bitWriter();
  bw.write(clear, size);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const combo = prefix + ',' + k;
    if (dict.has(combo)) {
      prefix = combo;
      continue;
    }
    bw.write(dict.get(prefix), size);
    if (next < (1 << maxSize)) {
      dict.set(combo, next++);
      if (next === (1 << size) && size < maxSize) size++;
    } else {
      bw.write(clear, size);
      reset();
    }
    prefix = String(k);
  }
  bw.write(dict.get(prefix), size);
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
  out.push(...u16(W), ...u16(H), 0xf2, 0, 0);
  for (const rgb of palette) out.push(...rgb);
  out.push(...wordBytes('NETSCAPE2.0').flatMap((_, idx, arr) => idx === 0 ? [0x21, 0xff, 0x0b, ...arr] : []));
  out.push(3, 1, 0, 0, 0);
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, 0x09, ...u16(delay), 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(W), ...u16(H), 0);
    out.push(3);
    out.push(...subBlocks(lzw(frame, 3)));
  }
  out.push(0x3b);
  return Buffer.from(out);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'bee-flying.gif'), gif([0, 1, 2, 3].map(i => makeFrame('fly', i)), 9));
fs.writeFileSync(path.join(OUT_DIR, 'bee-idle.gif'), gif([0, 1, 0, 0].map(i => makeFrame('idle', i)), 28));
fs.writeFileSync(path.join(OUT_DIR, 'bee-sleep.gif'), gif([0, 0, 0, 0].map(i => makeFrame('sleep', i)), 45));
