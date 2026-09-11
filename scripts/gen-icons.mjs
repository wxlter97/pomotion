// Genera los íconos de la app (favicon PNG, apple-touch-icon, manifest
// icons) proceduralmente, sin dependencias externas ni rasterizador de SVG
// disponible en la máquina. Dibuja a 4x y reduce (box filter) para
// suavizar bordes, y codifica PNG a mano (IHDR/IDAT vía zlib nativo/IEND).
//
// Uso: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

const SS = 4; // factor de supersampling para antialiasing

// --- PNG encoding -------------------------------------------------------

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // sin filtro
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- Primitivas de dibujo (hard-edge; el AA sale del downsample) --------

function makeCanvas(w, h) {
  return Buffer.alloc(w * h * 4, 0);
}

function setPixel(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const idx = (y * w + x) * 4;
  if (idx < 0 || idx + 3 >= buf.length) return;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function insideRoundedRect(x, y, w, h, r) {
  if (x < 0 || x >= w || y < 0 || y >= h) return false;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundedRect(buf, w, h, x0, y0, x1, y1, r, color) {
  const rw = x1 - x0;
  const rh = y1 - y0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
      if (insideRoundedRect(x - x0, y - y0, rw, rh, r)) {
        setPixel(buf, w, x, y, ...color);
      }
    }
  }
}

function fillCircle(buf, w, h, cx, cy, r, color) {
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(buf, w, x, y, ...color);
    }
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projx = x1 + t * dx;
  const projy = y1 + t * dy;
  const ddx = px - projx;
  const ddy = py - projy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function drawLine(buf, w, h, x1, y1, x2, y2, thickness, color) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - thickness));
  const maxX = Math.min(w, Math.ceil(Math.max(x1, x2) + thickness));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - thickness));
  const maxY = Math.min(h, Math.ceil(Math.max(y1, y2) + thickness));
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (distToSegment(x, y, x1, y1, x2, y2) <= thickness / 2) setPixel(buf, w, x, y, ...color);
    }
  }
}

function downsample(buf, bigSize, factor) {
  const outSize = bigSize / factor;
  const out = Buffer.alloc(outSize * outSize * 4);
  for (let oy = 0; oy < outSize; oy++) {
    for (let ox = 0; ox < outSize; ox++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const idx = ((oy * factor + dy) * bigSize + (ox * factor + dx)) * 4;
          r += buf[idx];
          g += buf[idx + 1];
          b += buf[idx + 2];
          a += buf[idx + 3];
        }
      }
      const n = factor * factor;
      const oidx = (oy * outSize + ox) * 4;
      out[oidx] = Math.round(r / n);
      out[oidx + 1] = Math.round(g / n);
      out[oidx + 2] = Math.round(b / n);
      out[oidx + 3] = Math.round(a / n);
    }
  }
  return out;
}

// --- El ícono: marca wxlter. — fondo tinta plano (sin gradiente, sin
// esquinas redondeadas: el propio SO aplica su máscara al ícono) con una
// carátula de cronómetro en amarillo faro. -------------------------------

function drawIcon(size) {
  const w = size;
  const h = size;
  const buf = makeCanvas(w, h);

  const ink = [17, 17, 17, 255]; // #111111
  fillRoundedRect(buf, w, h, 0, 0, w, h, 0, ink);

  const cx = w * 0.5;
  const cy = h * 0.54;
  const faceR = w * 0.29;
  const faro = [255, 219, 0, 255]; // #ffdb00
  const ringT = w * 0.045;
  fillCircle(buf, w, h, cx, cy, faceR, faro);
  fillCircle(buf, w, h, cx, cy, faceR - ringT, ink);

  const crownW = w * 0.1;
  const crownH = h * 0.08;
  fillRoundedRect(
    buf,
    w,
    h,
    cx - crownW / 2,
    cy - faceR - crownH * 0.5,
    cx + crownW / 2,
    cy - faceR - crownH * 0.5 + crownH,
    0,
    faro
  );

  drawLine(buf, w, h, cx, cy, cx, cy - faceR * 0.55, w * 0.026, faro);
  drawLine(buf, w, h, cx, cy, cx + faceR * 0.4, cy + faceR * 0.2, w * 0.026, faro);
  fillCircle(buf, w, h, cx, cy, w * 0.03, faro);

  return buf;
}

function generate(size, filename) {
  const big = drawIcon(size * SS);
  const small = downsample(big, size * SS, SS);
  const png = encodePNG(size, size, small);
  writeFileSync(join(outDir, filename), png);
  console.log(`✓ ${filename} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

generate(32, 'favicon-32.png');
generate(180, 'apple-touch-icon.png');
generate(192, 'icon-192.png');
generate(512, 'icon-512.png');

console.log('Listo.');
