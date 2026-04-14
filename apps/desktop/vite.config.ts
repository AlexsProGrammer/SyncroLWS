import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Tauri expects a fixed dev server port
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Watch Rust source changes
      ignored: ['**/src-tauri/**'],
    },
  },
  // Prevent vite from obscuring Rust errors
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri supports ES2021 in all platforms
    target: process.env['TAURI_PLATFORM'] === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env['TAURI_DEBUG'] ? 'esbuild' : false,
    sourcemap: !!process.env['TAURI_DEBUG'],
  },
}));
