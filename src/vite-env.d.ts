/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** vite.config.ts가 public/data/words.csv의 SHA-256으로 주입한다. */
declare const __WORDS_DATA_VERSION__: string;
