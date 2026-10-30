'use strict';

// Renders the pixel-art app icon (same pixels as public/icon.svg) to the PNG sizes phones need
// for home-screen apps and notifications. Run once after changing the icon:
//
//   node scripts/make-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INK = [0x1c, 0x1c, 0x1c];
const RED = [0xc8, 0x40, 0x2f];
const PAPER = [0xef, 0xeb, 0xe2];

// [x, y, width, height, colour] on a 16×16 grid, painted in order (as in icon.svg)
const RECTS = [
  [1, 2, 14, 10, INK], [2, 1, 12, 12, INK], [2, 3, 12, 8, RED], [3, 2, 10, 10, RED],
  [3, 13, 3, 1, INK], [3, 12, 2, 2, INK],
  [6, 4, 4, 1, INK], [9, 5, 1, 2, INK], [7, 7, 2, 1, INK], [7, 9, 2, 1, INK],
];

const OUT = path.join(__dirname, '..', 'public');
const SIZES = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

function render(size) {
  const scale = Math.floor((size * 0.86) / 16); // leave a margin: phones crop icons into rounded squares
  const offset = Math.floor((size - scale * 16) / 2);
  const grid = Array.from({ length: 16 }, () => Array(16).fill(null));
  for (const [x, y, w, h, colour] of RECTS) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = colour;
  }
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0, then RGB
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - offset) / scale);
      const gy = Math.floor((y - offset) / scale);
      const inside = gx >= 0 && gx < 16 && gy >= 0 && gy < 16 && x >= offset && y >= offset;
      const [r, g, b] = (inside && grid[gy][gx]) || PAPER;
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of Object.entries(SIZES)) {
  fs.writeFileSync(path.join(OUT, name), render(size));
  console.log(`public/${name} (${size}×${size})`);
}
