import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5173,
    host: 'localhost',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    sourcemap: false,
    // livekit-client ships as one prebundled ESM module. Route-level lazy
    // loading keeps it off Control Room's initial path; the production chunk is
    // about 530 kB minified and 138 kB gzip.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      onwarn(warning, warn) {
        // Ignore sourcemap warnings from vad-react
        if (warning.code === 'SOURCEMAP_ERROR') return;
        warn(warning);
      },
    },
  },
});
