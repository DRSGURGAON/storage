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
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        /*
         * React and Ant Design are ~85% of the bundle and change only when
         * a dependency is upgraded; the app's own code changes every
         * release. Shipped as one file, a one-line fix makes a warehouse
         * phone re-download half a megabyte over whatever signal it has
         * inside a shed. Split, that download is the part that actually
         * changed.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-')) return 'antd';
          if (id.includes('react') || id.includes('scheduler')) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
