import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { outDir: 'dist', assetsDir: 'rd-assets', sourcemap: false, chunkSizeWarningLimit: 900 } });
