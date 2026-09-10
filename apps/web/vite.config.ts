import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dev server proxies `/api` to the NestJS app rather than the browser
 * calling it cross-origin. That keeps the frontend's fetches same-origin in
 * development, which means no CORS configuration on the API and no
 * environment-specific base URL compiled into the bundle: `VITE_API_URL`
 * only exists for a deployment that really does serve the two from
 * different hosts.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
