
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const DEV_PORT = Number(process.env.DESIGN_SPACE_DEV_PORT ?? 5174)
const INTERNAL_PRODUCT_FORGE_ENABLED = process.env.DESIGN_SPACE_INTERNAL_PRODUCT_FORGE === 'true'
const PUBLIC_PRODUCT_FORGE_STUB = fileURLToPath(
  new URL('./src/editor/config/publicProductForgeUnavailable.ts', import.meta.url)
)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __DESIGN_SPACE_INTERNAL_PRODUCT_FORGE__: JSON.stringify(INTERNAL_PRODUCT_FORGE_ENABLED),
  },
  resolve: {
    alias: INTERNAL_PRODUCT_FORGE_ENABLED
      ? []
      : [
          {
            find: '../productForge/generateProductForgeArtifacts',
            replacement: PUBLIC_PRODUCT_FORGE_STUB,
          },
          {
            find: '../productForge/packageProductForgeZip',
            replacement: PUBLIC_PRODUCT_FORGE_STUB,
          },
        ],
    // Prevent duplicate React instances across mixed import paths in dev.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: 'localhost',
    port: DEV_PORT,
    strictPort: true,
    hmr: {
      host: 'localhost',
      port: DEV_PORT,
      clientPort: DEV_PORT,
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (
            id.includes('/node_modules/react-dom/')
            || id.includes('/node_modules/react/')
            || id.includes('/node_modules/scheduler/')
            || id.includes('/node_modules/use-sync-external-store/')
          ) {
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
