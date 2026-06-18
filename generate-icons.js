/* Generates PNG app icons with no external dependencies (pure Node + zlib). */
const fs = require("fs");
const zlib = require("zlib");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function makeIcon(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const r = maskable ? size : size * 0.46; // maskable: fill; normal: rounded square handled by bg
  const radius = size * 0.22; // rounded corners for non-maskable

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // gradient background 6c8cff -> 9d7bff
      const t = (x + y) / (2 * size);
      let R = lerp(0x6c, 0x9d, t), G = lerp(0x8c, 0x7b, t), B = lerp(0xff, 0xff, t);
      let a = 255;

      if (!maskable) {
        // rounded square mask
        const dx = Math.max(radius - x, x - (size - radius), 0);
        const dy = Math.max(radius - y, y - (size - radius), 0);
        if (Math.hypot(dx, dy) > radius) a = 0;
      }

      // draw a four-point star (diamond) in white
      const nx = (x - cx) / (size * 0.30);
      const ny = (y - cy) / (size * 0.30);
      const star = Math.abs(nx) + Math.abs(ny); // diamond
      if (star < 1) {
        const edge = Math.min(1, (1 - star) * 6);
        R = lerp(R, 255, edge); G = lerp(G, 255, edge); B = lerp(B, 255, edge);
      }

      buf[i] = R; buf[i + 1] = G; buf[i + 2] = B; buf[i + 3] = a;
    }
  }
  return png(size, size, buf);
}

fs.mkdirSync("icons", { recursive: true });
fs.writeFileSync("icons/icon-192.png", makeIcon(192, false));
fs.writeFileSync("icons/icon-512.png", makeIcon(512, false));
fs.writeFileSync("icons/icon-maskable.png", makeIcon(512, true));
console.log("icons generated");
