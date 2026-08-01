import { defineConfig } from 'vite'
import { resolve } from 'path'

/** Map clean public URLs → files under /pages */
const PAGE_REWRITES = {
  '/': '/pages/site/index.html',
  '/index.html': '/pages/site/index.html',
  '/services.html': '/pages/site/services.html',
  '/verify.html': '/pages/site/verify.html',
  '/sectors.html': '/pages/site/sectors.html',
  '/market-data.html': '/pages/site/market-data.html',
  '/rules-and-regulations.html': '/pages/site/rules-and-regulations.html',
  '/media-centre.html': '/pages/site/media-centre.html',
  '/media.html': '/pages/site/media.html',
  '/directory.html': '/pages/site/directory.html',
  '/contact.html': '/pages/site/contact.html',
  '/admin': '/pages/admin/index.html',
  '/admin/': '/pages/admin/index.html',
  '/admin.html': '/pages/admin/index.html',
  '/admin/login': '/pages/admin/login.html',
  '/admin/login.html': '/pages/admin/login.html',
  '/admin-login.html': '/pages/admin/login.html',
}

function rewritePlugin() {
  return {
    name: 'pages-url-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next()
        const [pathname, qs] = req.url.split('?')
        const target = PAGE_REWRITES[pathname]
        if (target) {
          req.url = qs ? `${target}?${qs}` : target
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next()
        const [pathname, qs] = req.url.split('?')
        const target = PAGE_REWRITES[pathname]
        if (target) {
          req.url = qs ? `${target}?${qs}` : target
        }
        next()
      })
    },
  }
}

export default defineConfig({
  publicDir: 'public',
  plugins: [rewritePlugin()],
  server: {
    port: 5173,
    open: '/',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  assetsInclude: ['**/*.gif'],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'pages/site/index.html'),
        services: resolve(__dirname, 'pages/site/services.html'),
        verify: resolve(__dirname, 'pages/site/verify.html'),
        sectors: resolve(__dirname, 'pages/site/sectors.html'),
        marketData: resolve(__dirname, 'pages/site/market-data.html'),
        rulesAndRegulations: resolve(__dirname, 'pages/site/rules-and-regulations.html'),
        mediaCentre: resolve(__dirname, 'pages/site/media-centre.html'),
        media: resolve(__dirname, 'pages/site/media.html'),
        directory: resolve(__dirname, 'pages/site/directory.html'),
        contact: resolve(__dirname, 'pages/site/contact.html'),
        admin: resolve(__dirname, 'pages/admin/index.html'),
        adminLogin: resolve(__dirname, 'pages/admin/login.html'),
      },
    },
  },
})
