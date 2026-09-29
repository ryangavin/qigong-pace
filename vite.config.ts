import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Every root-level page is a build entry, so a new page needs no config change.
const root = import.meta.dirname
const pages = Object.fromEntries(
  readdirSync(root)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.slice(0, -'.html'.length), resolve(root, f)]),
)

export default defineConfig({
  build: { rollupOptions: { input: pages } },
})
