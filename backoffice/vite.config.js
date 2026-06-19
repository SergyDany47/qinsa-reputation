import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Puerto 5174 para no chocar con la demo-app (5173)
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
})
