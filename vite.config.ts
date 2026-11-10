import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = `http://127.0.0.1:${process.env.PORT || env.PORT || 3000}`;
  // Preserve the browser Host so the API can enforce its same-origin write guard.
  const proxy = { target, changeOrigin: false };
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, proxy: { '/api': proxy, '/media': proxy } },
    build: { outDir: 'dist/client', emptyOutDir: true },
  };
});
