import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const demoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: demoRoot,
  base: './',
  publicDir: path.resolve(demoRoot, 'public'),
  envPrefix: ['VITE_', 'POLLI_', 'POLLINATIONS_'],
  build: {
    outDir: path.resolve(demoRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(demoRoot, 'index.html'),
        mobile: path.resolve(demoRoot, 'mobile/index.html'),
      },
    },
  },
});
