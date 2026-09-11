import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The storage app talks to the same API as the 3PL app, through the same
 * same-origin `/api` proxy: no CORS to configure, and no API base URL
 * compiled into the bundle.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React changes rarely and the app changes often; splitting them
        // means a release ships ~30 kB rather than the whole bundle.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
});
