import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The contracts package is consumed as TypeScript source from the workspace,
  // so it must not be pre-bundled as a dependency.
  optimizeDeps: { exclude: ['@flowdesk/contracts'] },
  server: {
    port: 5173,
    proxy: {
      // Same-origin during development: cookies work without CORS gymnastics.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/pm'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
