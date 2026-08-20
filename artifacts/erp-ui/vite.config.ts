import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// PORT and BASE_PATH are injected by Replit's artifact system.
// When running locally in VS Code they default to sensible values.
const port = Number(process.env.PORT ?? '5173');
const basePath = process.env.BASE_PATH ?? '/';

const isReplit = process.env.REPL_ID !== undefined;
const usePolling =
  process.env.VITE_USE_POLLING === '1' ||
  (!isReplit && process.platform === 'linux');

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // Replit-only plugins: error overlay, code cartographer, dev banner
    ...(isReplit && process.env.NODE_ENV !== 'production'
      ? [
          (await import('@replit/vite-plugin-runtime-error-modal')).default(),
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    watch: {
      usePolling,
      interval: Number(process.env.VITE_POLL_INTERVAL ?? '1000'),
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/.turbo/**',
      ],
    },
    fs: {
      strict: true,
    },
    // Proxy /api calls to Django in local dev.
    // On Replit this is handled by the platform router, so it's a no-op there.
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
