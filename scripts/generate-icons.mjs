// PWA 아이콘 생성기 — 외부 의존성 없이 Node 내장 zlib로 PNG를 만든다.
// 사용: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// ---- PNG 인코딩 ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 그리기 ----
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * @param {number} size 픽셀 크기
 * @param {boolean} fullBleed maskable/애플 아이콘용 (모서리 라운딩 없이 꽉 채움)
 */
function drawIcon(size, fullBleed) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = fullBleed ? 0 : size * 0.22;
  // 'W' 획: (x, y) 단위 좌표
  const pts = [
    [0.27, 0.36],
    [0.395, 0.66],
    [0.5, 0.44],
    [0.605, 0.66],
    [0.73, 0.36],
  ];
  const strokeW = size * 0.045;
  // maskable은 safe zone(중앙 80%)에 맞게 살짝 축소
  const scale = fullBleed ? 0.82 : 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // 라운드 사각형 판정
      let inside = true;
      if (radius > 0) {
        const cx = Math.max(radius, Math.min(size - radius, x));
        const cy = Math.max(radius, Math.min(size - radius, y));
        inside = Math.hypot(x - cx, y - cy) <= radius;
      }
      if (!inside) {
        rgba[i + 3] = 0;
        continue;
      }

      // 배경: 인디고 세로 그라디언트
      const t = y / size;
      rgba[i] = Math.round(0x63 + (0x43 - 0x63) * t); // R 0x63→0x43
      rgba[i + 1] = Math.round(0x66 + (0x38 - 0x66) * t); // G 0x66→0x38
      rgba[i + 2] = Math.round(0xf1 + (0xca - 0xf1) * t); // B 0xf1→0xca
      rgba[i + 3] = 255;

      // 'W' 흰색 획 (안티앨리어싱)
      const ux = (x / size - 0.5) / scale + 0.5;
      const uy = (y / size - 0.5) / scale + 0.5;
      let d = Infinity;
      for (let s = 0; s < pts.length - 1; s++) {
        d = Math.min(
          d,
          distToSegment(ux * size, uy * size, pts[s][0] * size, pts[s][1] * size, pts[s + 1][0] * size, pts[s + 1][1] * size),
        );
      }
      const a = Math.max(0, Math.min(1, (strokeW - d) / (size * 0.008)));
      if (a > 0) {
        rgba[i] = Math.round(rgba[i] + (255 - rgba[i]) * a);
        rgba[i + 1] = Math.round(rgba[i + 1] + (255 - rgba[i + 1]) * a);
        rgba[i + 2] = Math.round(rgba[i + 2] + (255 - rgba[i + 2]) * a);
      }
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(join(outDir, 'icon-192.png'), drawIcon(192, false));
writeFileSync(join(outDir, 'icon-512.png'), drawIcon(512, false));
writeFileSync(join(outDir, 'maskable-512.png'), drawIcon(512, true));
writeFileSync(join(outDir, 'apple-touch-icon.png'), drawIcon(180, true));

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/>
</linearGradient></defs>
<rect width="100" height="100" rx="22" fill="url(#g)"/>
<path d="M27 36 L39.5 66 L50 44 L60.5 66 L73 36" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
writeFileSync(join(outDir, 'favicon.svg'), favicon);

console.log('icons written to', outDir);
