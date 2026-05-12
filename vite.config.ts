import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = parseInt(env.PORT || '3001');
  const vitePort = parseInt(env.VITE_PORT || '5173');

  return {
    plugins: [react()],
    server: {
      port: vitePort,
      proxy: {
        '/api': `http://localhost:${serverPort}`,
        '/files': `http://localhost:${serverPort}`
      }
    }
  }
})
