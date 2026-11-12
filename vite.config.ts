/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite is kept ONLY as the Vitest engine. The app is built by Next.js (next build).
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same alias as tsconfig `paths`. The shadcn/ui files import `@/lib/utils`.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'playground/**/*.test.{ts,tsx}'],
  },
})
