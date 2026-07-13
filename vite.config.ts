/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages는 https://USERNAME.github.io/REPOSITORY/ 하위 경로에 배포되므로
// 배포 워크플로에서 BASE_PATH=/REPOSITORY/ 로 지정한다. 로컬 개발은 '/'.
const base = process.env.BASE_PATH ?? '/';
const wordsDataVersion = createHash('sha256')
  .update(readFileSync(new URL('./public/data/words.csv', import.meta.url)))
  .digest('hex');

export default defineConfig({
  base,
  // CSV가 바뀌면 JS 번들도 자동으로 바뀌고, 기존 IndexedDB에 한 번 동기화된다.
  define: {
    __WORDS_DATA_VERSION__: JSON.stringify(wordsDataVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        id: base,
        name: 'WordFlip — 영어 단어 카드',
        short_name: 'WordFlip',
        description: '오프라인에서 하루 종일 넘겨 보는 개인용 영어 단어 카드',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#f2f3f8',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 앱 셸 + 초기 단어 CSV까지 모두 precache → 설치 후 완전 오프라인 동작
        globPatterns: ['**/*.{js,css,html,ico,png,svg,csv,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
