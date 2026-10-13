import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.ARENA_WEB_HOST ?? '0.0.0.0',
    port: Number(process.env.ARENA_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: Object.fromEntries(['/api', '/auth', '/health'].map((path) => [path, process.env.ARENA_API_URL ?? 'http://localhost:3001'])),
  },
});
