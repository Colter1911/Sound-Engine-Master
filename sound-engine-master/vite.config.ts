import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: false, // Disable minification for debugging
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'module.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'styles/sound-engine-v5.css';
          }
          return assetInfo.name || 'asset';
        }
      }
    }
  },
  esbuild: {
    drop: [], // Ensure console and debugger are NOT dropped
    minifyIdentifiers: false, // Optional: easier debugging
    keepNames: true // Optional: easier debugging
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@sync': path.resolve(__dirname, 'src/sync'),
      '@state': path.resolve(__dirname, 'src/state'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@lib': path.resolve(__dirname, 'src/library'),
      '@queue': path.resolve(__dirname, 'src/queue'),
      '@storage': path.resolve(__dirname, 'src/storage'),
      '@t': path.resolve(__dirname, 'src/types')
    }
  }
});