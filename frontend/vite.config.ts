import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Доступ к Vite с компьютера и из контейнера Nginx.
    port: 5173,
    proxy: {
      // При прямом открытии Vite запросы /api тоже должны попадать в FastAPI.
      '/api': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
    },
  },
})
