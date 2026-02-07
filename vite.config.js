import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  base: '/',
  esbuild: command === 'build' ? {
    drop: ['console', 'debugger'],
  } : {},
  optimizeDeps: {
    include: [
      'ethers',
      '@ethersproject/providers',
      '@ethersproject/abi',
      '@ethersproject/bignumber',
      'bn.js',
      'js-sha3'
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
    },
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        '404': resolve(__dirname, '404.html'),
      },
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  define: {
    global: {},
  },
}));
