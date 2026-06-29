import { defineConfig } from 'vite';
import neonApiPlugin from './vite-neon-api.js';

// Renderer runs from project root; build output goes to dist/
export default defineConfig({
  base: './',
  plugins: [neonApiPlugin()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
