import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    minify: 'esbuild',
    outDir: resolve(projectDir, '../public/operations-assets'),
    emptyOutDir: true,
    lib: {
      entry: resolve(projectDir, 'src/main.tsx'),
      formats: ['es'],
      fileName: () => 'operations-app.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: assetInfo => assetInfo.name?.endsWith('.css')
          ? 'operations-app.css'
          : 'assets/[name]-[hash][extname]'
      }
    }
  }
});
