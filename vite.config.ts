import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: './src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress EVAL warnings from lottie-web (known upstream issue)
        if (warning.code === 'EVAL' && warning.id && warning.id.includes('lottie-web')) return
        // Suppress false IMPORT_IS_UNDEFINED warnings for CJS interop packages
        if (warning.code === 'IMPORT_IS_UNDEFINED' && warning.message) {
          if (warning.message.includes('react-window') || warning.message.includes('react-virtualized-auto-sizer')) return
        }
        warn(warning)
      },
    },
  },
  server: {
    port: 5173,
  },
})