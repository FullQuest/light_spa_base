import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Чтобы dev-сервер был доступен извне контейнера
    port: 5173,
    proxy: {
      // Все запросы, начинающиеся с /auth, будут перенаправлены на FastAPI
      '/auth': {
        target: 'http://api:8000', // Имя сервиса в docker-compose
        changeOrigin: true,
      },
    },
  },
})
