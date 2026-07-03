import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: a new deploy silently replaces the old service worker on the
      // next visit — no stale-app-forever risk, no manual "refresh" prompt needed.
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'XL ERP',
        short_name: 'XL ERP',
        description: 'Billing, inventory and accounts for XL Traders',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Precache the app shell (all built JS/CSS/HTML) so the app opens offline.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        // SPA: unknown routes fall back to index.html (client-side router takes over).
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Supabase REST reads ONLY (/rest/v1): network-first so data is
            // ALWAYS fresh when online; the cache serves as an offline fallback
            // ("offline view" of last-seen data). Writes are never cached, and
            // /auth/v1 (session/identity) is deliberately excluded.
            // SECURITY: the Cache API keys by URL only (not by auth token), so
            // this cache MUST be purged on every sign-in/out — useAuth.ts does
            // that — or one user's data could be served to the next user on a
            // shared device.
            urlPattern: ({ url, request }) =>
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.startsWith('/rest/v1/') &&
              request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-reads',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 }
            }
          },
          {
            // Google Fonts stylesheets + font files: cache-first, they never change.
            urlPattern: ({ url }) =>
              url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          }
        ]
      }
    })
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173 }
});
