import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Only DOD_API_* (address of the local backend) is read here; it never reaches the bundle.
  const env = loadEnv(mode, process.cwd(), 'DOD_API_')
  const host = env.DOD_API_HOST && env.DOD_API_HOST !== '0.0.0.0' ? env.DOD_API_HOST : '127.0.0.1'
  // Every /api request goes to the DOD API. xfwd adds the visitor's address to X-Forwarded-For, so the login
  // throttle counts each visitor separately when the API trusts this proxy (DOD_TRUSTED_PROXIES=127.0.0.1).
  const proxy = { '/api': { target: `http://${host}:${env.DOD_API_PORT || '8181'}`, changeOrigin: false, xfwd: true } }
  // `vite preview` serves the production build with the production security headers. The policy is read
  // from public/web.config (IIS, the production web server: the single source; tests/csp.test.ts checks it).
  // The dev server gets none: hot reload needs inline scripts.
  const csp = /name="Content-Security-Policy" value="([^"]+)"/.exec(readFileSync(new URL('./public/web.config', import.meta.url), 'utf8'))?.[1]
  if (!csp) throw new Error('public/web.config: Content-Security-Policy not found')
  const headers = { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' }

  // Hashed build files (/assets/*) never change, so `vite preview` caches them like IIS does (public/web.config:
  // 365 days). Its file server would otherwise send `no-cache`, and every page load revalidates each file again.
  const previewAssetCache: Plugin = {
    name: 'dod-preview-asset-cache',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/assets/')) {
          const setHeader = res.setHeader.bind(res)
          res.setHeader = (name, value) => setHeader(name, name.toLowerCase() === 'cache-control' ? 'public, max-age=31536000, immutable' : value)
        }
        next()
      })
    },
  }

  return {
    plugins: [react(), previewAssetCache],
    // Fixed ports (5180 dev, 8100 preview), never silently moved to another one: DOD Minimal runs next to other
    // local web apps. `--port` on the command line (scripts/run.ps1 -Port) still overrides them.
    server: { port: 5180, strictPort: true, proxy },
    preview: { port: 8100, strictPort: true, proxy, headers },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      // ECharts is lazy-loaded and already tree-shaken to the charts DOD uses.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Shared code goes in a few chunks instead of dozens of 1 KB files (one per icon or small component): on a
          // slow or high-latency connection every extra file costs a round trip, and pages wait for them in waves.
          manualChunks(id) {
            if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts'
            if (id.includes('node_modules/lucide-react')) return 'icons'
            // components/charts stays out: it imports ECharts, which must load only with a chart (not at sign-in).
            if (/[\\/]src[\\/](components|hooks|utils)[\\/]/.test(id) && !/[\\/]components[\\/]charts[\\/]/.test(id)) return 'ui'
            return undefined
          },
        },
      },
    },
  }
})
