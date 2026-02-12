
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/')) {
            return 'vendor-react';
          }
          if (id.includes('/node_modules/fabric/')) {
            return 'vendor-fabric';
          }
          if (
            id.includes('/node_modules/pdfjs-dist/')
            || id.includes('/node_modules/pdf-lib/')
            || id.includes('/node_modules/jspdf/')
          ) {
            return 'vendor-pdf';
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'vendor-lucide';
          }
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/immer/')) {
            return 'vendor-state';
          }
          if (id.includes('/node_modules/lodash/')) {
            return 'vendor-lodash';
          }
          if (id.includes('/node_modules/react-draggable/')) {
            return 'vendor-draggable';
          }
          if (id.includes('/node_modules/dexie/') || id.includes('/node_modules/idb/')) {
            return 'vendor-db';
          }
          return 'vendor';
        },
      },
    },
  },
})
