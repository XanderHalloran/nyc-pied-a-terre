import { cpSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// data/processed is served as static assets so a re-ingest needs no rebuild.
export default defineConfig({
  plugins: [
    react(),
    // Vite takes one publicDir and the dataset already has it, so the hand-written static files —
    // robots.txt, sitemap.xml, the share card, and the two content pages a crawler can actually
    // read — are copied separately. Five lines beats moving a 23 MB generated file into source.
    { name: 'copy-public', closeBundle() { cpSync('public', 'dist', { recursive: true }) } },
  ],
  publicDir: 'data/processed',
  server: { port: 5180 },
})
