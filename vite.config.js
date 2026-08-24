import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['api/**/*.test.js'],
    // Dummy values so the handler's key/config checks don't 500 before reaching the
    // scrape/parsing logic under test, and so tests are hermetic (never depend on
    // whatever's in a developer's real local .env). 127.0.0.1:1 fails fast (connection
    // refused) instead of hanging on a real network timeout if rate-limiting is ever hit.
    env: {
      GROQ_API_KEY: 'test-groq-key',
      UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1',
      UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
    },
  },
})