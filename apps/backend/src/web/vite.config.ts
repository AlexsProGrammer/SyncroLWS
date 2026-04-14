import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Assets are requested at /portal/assets/… → Express strips /portal prefix → serves from dist/assets/…
  base: '/portal/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
