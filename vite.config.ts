import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Every root-level page is built: the app, and the energy layer's tuning harness.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        energy: resolve(import.meta.dirname, 'energy.html'),
      },
    },
  },
})
