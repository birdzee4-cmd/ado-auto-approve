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
  [255, 255, 255],
  [152, 216, 245],
  [82, 160, 210],
  [120, 74, 0],
  [245, 88, 113],
  [77, 146, 59],
  [43, 102, 38],
  [112, 118, 128],
  [208, 214, 224],
  [59, 130, 246],
  [250, 204, 21],
  [243, 244, 246]
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

function line(img, x0, y0, x1, y1, c) {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    lrect(img, x0, y0, 1, 1, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawEye(img, x, y, sleepy) {
  if (sleepy) {
    line(img, x, y, x + 2, y, 1);
    return;
  }
  lrect(img, x, y, 2, 2, 1);
  lrect(img, x + 1, y, 1, 1, 4);
}

function drawSmile(img, x, y) {
  lrect(img, x, y, 1, 1, 1);
  lrect(img, x + 1, y + 1, 2, 1, 1);
  lrect(img, x + 3, y, 1, 1, 1);
}

function drawWing(img, x, y, pose) {
  if (pose === 'up') {
    lrect(img, x + 1, y, 4, 1, 6);
    lrect(img, x, y + 1, 6, 4, 5);
    lrect(img, x + 1, y + 2, 4, 2, 15);
    lrect(img, x + 5, y + 2, 1, 2, 6);
  } else if (pose === 'down') {
    lrect(img, x, y + 3, 6, 1, 6);
    lrect(img, x, y + 4, 6, 4, 5);
    lrect(img, x + 1, y + 4, 4, 2, 15);
    lrect(img, x + 5, y + 5, 1, 2, 6);
  } else {
    lrect(img, x, y + 2, 6, 1, 6);
    lrect(img, x, y + 3, 6, 3, 5);
    lrect(img, x + 1, y + 3, 4, 1, 15);
  }
}

function drawAntennae(img, x, y, offset) {
  line(img, x + 5, y + 1, x + 4 + offset, y - 2, 1);
  line(img, x + 9, y + 1, x + 10 - offset, y - 2, 1);
  lrect(img, x + 3 + offset, y - 3, 2, 2, 7);
  lrect(img, x + 9 - offset, y - 3, 2, 2, 7);
}

function drawBeeBody(img, x, y, opts = {}) {
  const wingPose = opts.wing || 'idle';
  const sleepy = !!opts.sleepy;
  const smile = opts.smile !== false;
  const arm = opts.arm || 'none';
  const stripeShift = opts.stripeShift || 0;

  drawWing(img, x + 15, y + 2, wingPose);
  drawAntennae(img, x, y, opts.antennaOffset || 0);

  lrect(img, x + 2, y + 6, 3, 8, 1);
  lrect(img, x + 5, y + 4, 13, 2, 1);
  lrect(img, x + 5, y + 14, 13, 2, 1);
  lrect(img, x + 18, y + 6, 3, 8, 1);
  lrect(img, x + 5, y + 6, 13, 8, 2);
  lrect(img, x + 7 + stripeShift, y + 6, 2, 8, 1);
  lrect(img, x + 13 + stripeShift, y + 6, 2, 8, 1);
  lrect(img, x + 18, y + 8, 2, 4, 1);

  lrect(img, x + 18, y + 5, 8, 10, 1);
  lrect(img, x + 19, y + 6, 6, 8, 2);
  lrect(img, x + 20, y + 7, 1, 1, 14);
  lrect(img, x + 24, y + 7, 1, 1, 14);
  drawEye(img, x + 20, y + 9, sleepy);
  drawEye(img, x + 23, y + 9, sleepy);
  if (smile && !sleepy) drawSmile(img, x + 20, y + 12);

  if (arm === 'wave') {
    line(img, x + 4, y + 9, x, y + 6, 1);
    lrect(img, x - 1, y + 5, 2, 2, 1);
  } else if (arm === 'book') {
    line(img, x + 19, y + 12, x + 16, y + 15, 1);
    line(img, x + 24, y + 12, x + 27, y + 15, 1);
  } else {
    lrect(img, x + 1, y + 10, 3, 1, 1);
  }

  lrect(img, x + 8, y + 16, 2, 2, 1);
  lrect(img, x + 15, y + 16, 2, 2, 1);
  lrect(img, x + 21, y + 15, 2, 2, 1);
}

function drawFlyingBee(img, i) {
  const bob = [0, -1, 0, 1][i % 4];
  const wing = i % 2 === 0 ? 'up' : 'down';
  drawBeeBody(img, 2, 5 + bob, {
    wing,
    arm: 'wave',
    stripeShift: i % 2,
    antennaOffset: i % 2
  });
  lrect(img, 0, 10 + bob, 1, 1, 12);
  lrect(img, 1, 12 + bob, 1, 1, 12);
  lrect(img, 0, 14 + bob, 2, 1, 12);
  lrect(img, 8, 21, 12, 1, 12);
  lrect(img, 10, 22, 8, 1, 12);
}

function drawSleepBee(img, i) {
  const breathe = i % 2;
  lrect(img, 1, 18, 26, 3, 10);
  lrect(img, 3, 16, 23, 3, 9);
  lrect(img, 6, 15, 17, 1, 9);
  line(img, 2, 18, 8, 14, 10);
  line(img, 22, 15, 28, 18, 10);

  drawWing(img, 17, 6 + breathe, 'idle');
  drawAntennae(img, 3, 6 + breathe, 0);
  lrect(img, 4, 11 + breathe, 5, 5, 1);
  lrect(img, 7, 9 + breathe, 13, 2, 1);
  lrect(img, 7, 16 + breathe, 13, 2, 1);
  lrect(img, 20, 11 + breathe, 4, 5, 1);
  lrect(img, 7, 11 + breathe, 13, 5, 2);
  lrect(img, 10, 11 + breathe, 2, 5, 1);
  lrect(img, 16, 11 + breathe, 2, 5, 1);
  lrect(img, 20, 10 + breathe, 7, 7, 1);
  lrect(img, 21, 11 + breathe, 5, 5, 2);
  drawEye(img, 22, 13 + breathe, true);
  drawEye(img, 25, 13 + breathe, true);
  lrect(img, 9, 18 + breathe, 2, 2, 1);
  lrect(img, 17, 18 + breathe, 2, 2, 1);

  lrect(img, 23, 2, 2, 1, 13);
  lrect(img, 24, 3, 1, 1, 13);
  lrect(img, 23, 4, 3, 1, 13);
  lrect(img, 27, 5 - breathe, 2, 1, 13);
  lrect(img, 28, 6 - breathe, 1, 1, 13);
  lrect(img, 27, 7 - breathe, 3, 1, 13);
}

function drawBook(img, x, y, flap) {
  lrect(img, x, y + 1, 2, 7, 1);
  lrect(img, x + 2, y, 7, 8, 10);
  lrect(img, x + 9, y, 2, 8, 1);
  lrect(img, x + 11, y, 7, 8, 9);
  lrect(img, x + 18, y + 1, 2, 7, 1);
  lrect(img, x + 3, y + 1, 5, 1, 4);
  lrect(img, x + 12, y + 1, 5, 1, 4);
  lrect(img, x + 3, y + 4 + flap, 4, 1, 4);
  lrect(img, x + 12, y + 4, 4, 1, 4);
}

function drawReadingBee(img, i) {
  const bob = i === 1 ? -1 : 0;
  drawWing(img, 19, 7 + bob, 'idle');
  drawAntennae(img, 4, 6 + bob, 0);

  lrect(img, 7, 11 + bob, 4, 6, 1);
  lrect(img, 10, 9 + bob, 10, 2, 1);
  lrect(img, 10, 17 + bob, 10, 2, 1);
  lrect(img, 20, 11 + bob, 3, 6, 1);
  lrect(img, 10, 11 + bob, 10, 6, 2);
  lrect(img, 12, 11 + bob, 2, 6, 1);
  lrect(img, 17, 11 + bob, 2, 6, 1);

  lrect(img, 18, 8 + bob, 10, 10, 1);
  lrect(img, 19, 9 + bob, 8, 8, 2);
  lrect(img, 19, 11 + bob, 3, 3, 4);
  lrect(img, 24, 11 + bob, 3, 3, 4);
  lrect(img, 20, 12 + bob, 1, 1, 1);
  lrect(img, 25, 12 + bob, 1, 1, 1);
  lrect(img, 22, 12 + bob, 2, 1, 1);
  lrect(img, 20, 15 + bob, 1, 1, 1);
  lrect(img, 21, 16 + bob, 4, 1, 1);

  line(img, 12, 16 + bob, 9, 20, 1);
  line(img, 24, 16 + bob, 27, 20, 1);
  drawBook(img, 7, 16, i % 2);
  lrect(img, 12, 20, 2, 2, 1);
  lrect(img, 21, 20, 2, 2, 1);
  lrect(img, 7, 22, 20, 1, 12);
}

function makeFrame(kind, i) {
  const img = canvas();
  if (kind === 'fly') drawFlyingBee(img, i);
  else if (kind === 'read') drawReadingBee(img, i);
  else drawSleepBee(img, i);
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
  out.push(...u16(W), ...u16(H), 0xf3, 0, 0);
  for (const rgb of palette) out.push(...rgb);
  out.push(0x21, 0xff, 0x0b, ...wordBytes('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, 0x09, ...u16(delay), 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(W), ...u16(H), 0);
    out.push(4);
    out.push(...subBlocks(lzw(frame, 4)));
  }
  out.push(0x3b);
  return Buffer.from(out);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(path.join(OUT_DIR, 'bee_fly.gif'), gif([0, 1, 2, 3].map(i => makeFrame('fly', i)), 9));
fs.writeFileSync(path.join(OUT_DIR, 'bee_read.gif'), gif([0, 1, 0, 2].map(i => makeFrame('read', i)), 32));
fs.writeFileSync(path.join(OUT_DIR, 'bee_sleep.gif'), gif([0, 1, 0, 1].map(i => makeFrame('sleep', i)), 45));

fs.writeFileSync(path.join(OUT_DIR, 'bee-flying.gif'), gif([0, 1, 2, 3].map(i => makeFrame('fly', i)), 9));
fs.writeFileSync(path.join(OUT_DIR, 'bee-idle.gif'), gif([0, 1, 0, 2].map(i => makeFrame('read', i)), 32));
fs.writeFileSync(path.join(OUT_DIR, 'bee-sleep.gif'), gif([0, 1, 0, 1].map(i => makeFrame('sleep', i)), 45));
