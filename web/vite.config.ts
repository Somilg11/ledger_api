import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // Proxying means the browser only ever talks to one origin, so the API's
    // deny-by-default CORS policy needs no exception for local development.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/health': { target: apiTarget, changeOrigin: true },
      '/ready': { target: apiTarget, changeOrigin: true },
    },
  },
});
