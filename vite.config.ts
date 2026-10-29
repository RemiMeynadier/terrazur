import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://<user>.github.io/terrazur/ on GitHub Pages.
export default defineConfig({
  base: '/terrazur/',
  plugins: [react()],
})
