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
  [152, 216, 245],
  [77, 146, 59]
];

const colorMap = {
  8: 3,
  9: 7,
  10: 7,
  11: 4,
  12: 4,
  13: 6,
  14: 3,
  15: 5
};

function canvas() {
  return new Uint8Array(W * H);
}

function px(img, x, y, c) {
  if (c > 7) c = colorMap[c] || 1;
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
    lrect(img, x + 2, y, 5, 1, 6);
    lrect(img, x, y + 1, 8, 5, 6);
    lrect(img, x + 1, y + 2, 6, 3, 5);
    lrect(img, x + 7, y + 3, 1, 2, 6);
  } else if (pose === 'down') {
    lrect(img, x, y + 4, 8, 1, 6);
    lrect(img, x, y + 5, 8, 5, 6);
    lrect(img, x + 1, y + 5, 6, 3, 5);
    lrect(img, x + 7, y + 6, 1, 2, 6);
  } else {
    lrect(img, x, y + 2, 8, 1, 6);
    lrect(img, x, y + 3, 8, 4, 6);
    lrect(img, x + 1, y + 3, 6, 2, 5);
  }
}

function drawAntennae(img, x, y, offset) {
  line(img, x + 4, y + 2, x + 2 + offset, y - 2, 1);
  line(img, x + 9, y + 2, x + 11 - offset, y - 2, 1);
  lrect(img, x + 1 + offset, y - 3, 2, 2, 7);
  lrect(img, x + 10 - offset, y - 3, 2, 2, 7);
}

function drawBeeBody(img, x, y, opts = {}) {
  const wingPose = opts.wing || 'idle';
  const sleepy = !!opts.sleepy;
  const smile = opts.smile !== false;
  const arm = opts.arm || 'none';

  drawWing(img, x + 12, y, wingPose);
  drawAntennae(img, x + 17, y + 3, opts.antennaOffset || 0);

  lrect(img, x + 1, y + 9, 3, 4, 1);
  lrect(img, x + 4, y + 6, 16, 3, 1);
  lrect(img, x + 4, y + 17, 16, 3, 1);
  lrect(img, x + 20, y + 8, 3, 9, 1);
  lrect(img, x + 4, y + 9, 16, 8, 2);
  lrect(img, x + 6, y + 9, 3, 8, 1);
  lrect(img, x + 13, y + 9, 3, 8, 1);
  lrect(img, x + 19, y + 10, 3, 5, 1);

  lrect(img, x + 20, y + 5, 10, 13, 1);
  lrect(img, x + 21, y + 6, 8, 11, 2);
  lrect(img, x + 22, y + 8, 2, 2, 5);
  lrect(img, x + 27, y + 8, 2, 2, 5);
  drawEye(img, x + 22, y + 10, sleepy);
  drawEye(img, x + 26, y + 10, sleepy);
  if (smile && !sleepy) {
    lrect(img, x + 23, y + 14, 1, 1, 1);
    lrect(img, x + 24, y + 15, 3, 1, 1);
    lrect(img, x + 27, y + 14, 1, 1, 1);
  }

  if (arm === 'wave') {
    line(img, x + 5, y + 11, x + 1, y + 7, 1);
    lrect(img, x, y + 6, 2, 2, 1);
  } else if (arm === 'book') {
    line(img, x + 22, y + 15, x + 17, y + 19, 1);
    line(img, x + 28, y + 15, x + 30, y + 19, 1);
  } else {
    lrect(img, x + 2, y + 12, 3, 1, 1);
  }

  lrect(img, x + 7, y + 19, 2, 2, 1);
  lrect(img, x + 14, y + 19, 2, 2, 1);
  lrect(img, x + 23, y + 18, 2, 2, 1);
}

function drawFlyingBee(img, i) {
  const bob = [0, -2, -1, 1][i % 4];
  const wing = i % 2 === 0 ? 'up' : 'down';
  drawF4Bee(img, 2, 3 + bob, {
    wing,
    lean: i % 2,
    arm: i === 1 ? 'wave' : 'none'
  });
}

function drawSleepBee(img, i) {
  const breathe = i % 2;
  drawF4Wing(img, 7, 6 + breathe, 'mid', 'back');
  lrect(img, 2, 14 + breathe, 2, 4, 1);
  lrect(img, 4, 12 + breathe, 13, 2, 1);
  lrect(img, 4, 19 + breathe, 13, 2, 1);
  lrect(img, 17, 14 + breathe, 2, 5, 1);
  lrect(img, 4, 14 + breathe, 13, 5, 2);
  lrect(img, 6, 14 + breathe, 2, 5, 1);
  lrect(img, 11, 14 + breathe, 2, 5, 1);
  lrect(img, 15, 14 + breathe, 2, 5, 3);

  lrect(img, 16, 11 + breathe, 10, 10, 1);
  lrect(img, 17, 12 + breathe, 8, 8, 2);
  drawF4Face(img, 17, 13 + breathe, { sleepy: true });
  lrect(img, 7, 21 + breathe, 2, 1, 1);
  lrect(img, 13, 21 + breathe, 2, 1, 1);

  lrect(img, 23, 5, 2, 1, 13);
  lrect(img, 24, 6, 1, 1, 13);
  lrect(img, 23, 7, 3, 1, 13);
  lrect(img, 27, 8 - breathe, 2, 1, 13);
  lrect(img, 28, 9 - breathe, 1, 1, 13);
  lrect(img, 27, 10 - breathe, 3, 1, 13);
}

function drawBook(img, x, y, flap) {
  lrect(img, x, y + 1, 2, 7, 1);
  lrect(img, x + 2, y, 7, 8, 7);
  lrect(img, x + 9, y, 2, 8, 1);
  lrect(img, x + 11, y, 7, 8, 7);
  lrect(img, x + 18, y + 1, 2, 7, 1);
  lrect(img, x + 3, y + 1, 5, 1, 4);
  lrect(img, x + 12, y + 1, 5, 1, 4);
  lrect(img, x + 3, y + 4 + flap, 4, 1, 4);
  lrect(img, x + 12, y + 4, 4, 1, 4);
}

function drawF4Wing(img, x, y, pose, side) {
  const dx = side === 'back' ? -1 : 0;
  if (pose === 'up') {
    lrect(img, x + dx + 1, y, 4, 1, 6);
    lrect(img, x + dx, y + 1, 7, 3, 6);
    lrect(img, x + dx + 1, y + 2, 5, 1, 5);
  } else if (pose === 'down') {
    lrect(img, x + dx, y + 3, 7, 3, 6);
    lrect(img, x + dx + 1, y + 4, 5, 1, 5);
    lrect(img, x + dx + 2, y + 6, 4, 1, 6);
  } else {
    lrect(img, x + dx, y + 2, 7, 3, 6);
    lrect(img, x + dx + 1, y + 3, 5, 1, 5);
  }
}

function drawF4Face(img, x, y, opts) {
  if (opts.sleepy) {
    line(img, x + 1, y + 3, x + 3, y + 3, 1);
    line(img, x + 6, y + 3, x + 8, y + 3, 1);
    lrect(img, x + 4, y + 6, 2, 1, 1);
    return;
  }

  lrect(img, x + 1, y + 2, 2, 2, 1);
  lrect(img, x + 2, y + 2, 1, 1, 5);
  lrect(img, x + 7, y + 2, 2, 2, 1);
  lrect(img, x + 8, y + 2, 1, 1, 5);
  lrect(img, x + 4, y + 6, 1, 1, 1);
  lrect(img, x + 5, y + 7, 2, 1, 1);
  lrect(img, x + 7, y + 6, 1, 1, 1);
}

function drawF4Bee(img, x, y, opts = {}) {
  const wing = opts.wing || 'mid';
  const lean = opts.lean || 0;
  const sleepy = !!opts.sleepy;

  drawF4Wing(img, x + 5 + lean, y + 1, wing, 'back');
  drawF4Wing(img, x + 11 + lean, y + 1, wing, 'front');

  line(img, x + 10 + lean, y + 5, x + 8 + lean, y + 2, 1);
  line(img, x + 14 + lean, y + 5, x + 16 + lean, y + 2, 1);
  lrect(img, x + 7 + lean, y + 1, 2, 1, 1);
  lrect(img, x + 16 + lean, y + 1, 2, 1, 1);

  lrect(img, x + 1 + lean, y + 10, 2, 4, 1);
  lrect(img, x + 3 + lean, y + 8, 13, 2, 1);
  lrect(img, x + 3 + lean, y + 17, 13, 2, 1);
  lrect(img, x + 16 + lean, y + 10, 2, 7, 1);
  lrect(img, x + 3 + lean, y + 10, 13, 7, 2);
  lrect(img, x + 5 + lean, y + 10, 2, 7, 1);
  lrect(img, x + 10 + lean, y + 10, 2, 7, 1);
  lrect(img, x + 14 + lean, y + 10, 2, 7, 3);

  lrect(img, x + 15 + lean, y + 7, 10, 12, 1);
  lrect(img, x + 16 + lean, y + 8, 8, 10, 2);
  lrect(img, x + 16 + lean, y + 12, 1, 2, 15);
  lrect(img, x + 24 + lean, y + 12, 1, 2, 15);
  drawF4Face(img, x + 16 + lean, y + 9, { sleepy });

  if (opts.arm === 'book') {
    line(img, x + 17 + lean, y + 17, x + 13 + lean, y + 20, 1);
    line(img, x + 22 + lean, y + 17, x + 24 + lean, y + 20, 1);
  } else if (opts.arm === 'wave') {
    line(img, x + 4 + lean, y + 12, x + 1 + lean, y + 9, 1);
    lrect(img, x + lean, y + 8, 2, 2, 1);
  } else {
    lrect(img, x + 2 + lean, y + 13, 3, 1, 1);
  }

  lrect(img, x + 6 + lean, y + 19, 2, 1, 1);
  lrect(img, x + 12 + lean, y + 19, 2, 1, 1);
  lrect(img, x + 19 + lean, y + 19, 2, 1, 1);
}

function drawReadingBee(img, i) {
  const bob = i === 1 ? -1 : 0;
  drawF4Bee(img, 3, 3 + bob, {
    wing: i % 2 === 0 ? 'mid' : 'up',
    arm: 'book'
  });
  drawBook(img, 7, 15 + bob, i % 2);
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
  let size = minCodeSize + 1;
  const bw = bitWriter();

  bw.write(clear, size);

  // Keep the stream deliberately simple: write literal pixels and clear before
  // the decoder's dynamic table would require a larger code size.
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
  out.push(...u16(W), ...u16(H), 0xf2, 0, 0);
  for (const rgb of palette) out.push(...rgb);
  out.push(0x21, 0xff, 0x0b, ...wordBytes('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
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

fs.writeFileSync(path.join(OUT_DIR, 'bee_fly.gif'), gif([0, 1, 2, 3].map(i => makeFrame('fly', i)), 9));
fs.writeFileSync(path.join(OUT_DIR, 'bee_read.gif'), gif([0, 1, 0, 2].map(i => makeFrame('read', i)), 32));
fs.writeFileSync(path.join(OUT_DIR, 'bee_sleep.gif'), gif([0, 1, 0, 1].map(i => makeFrame('sleep', i)), 45));
