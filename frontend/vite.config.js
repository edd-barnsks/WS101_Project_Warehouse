import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import * as url from 'url'
import tailwindcss from '@tailwindcss/vite'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, __dirname, '')
  // Where the PHP API lives while you develop (npm run dev). The app calls /api/... and Vite forwards it here,
  // so the browser sees one origin and no CORS setup is needed. Change it in .env (see .env.example).
  const target = (env.VITE_API_PROXY_TARGET || 'http://localhost/PHP_Backend_For_WS101/index.php').replace(/\/+$/, '')
  const targetUrl = new URL(target)
  const basePath = targetUrl.pathname === '/' ? '' : targetUrl.pathname

  const proxy = {
    '/api': {
      target: targetUrl.origin,
      changeOrigin: true,
      rewrite: (path) => basePath + path.replace(/^\/api/, ''),
    },
  }

  return {
    // Relative links in a build, so the built site works from any folder (e.g. htdocs/warehouse/) and not only from the site root.
    base: command === 'build' ? './' : '/',
    plugins: [
      tailwindcss(),
    ],
    server: { proxy },
    preview: { proxy },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          app: resolve(__dirname, 'app.html'),
        },
      },
    },
  }
})
