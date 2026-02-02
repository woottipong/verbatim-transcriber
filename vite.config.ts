import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5173,
    host: 'localhost',
    headers: {
      // Required for SharedArrayBuffer (used by ONNX Runtime WASM)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  optimizeDeps: {
    include: ['@ricky0123/vad-react', '@ricky0123/vad-web'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.onnx', '**/*.wasm'],
  build: {
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        // Ignore sourcemap warnings from vad-react
        if (warning.code === 'SOURCEMAP_ERROR') return;
        warn(warning);
      },
    },
  },
});
