// Vite configuration for Callex Dashboard
// Dev proxy: forwards /api and /health to the Python backend
// This means you can keep `const API_BASE = '/api'` in JS — no URL changes needed
export default {
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8085',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8085',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
};
