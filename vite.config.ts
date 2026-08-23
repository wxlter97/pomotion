import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev: `npm run dev` sirve el frontend en :5173 y hace proxy de /api
// hacia `vercel dev` (típicamente :3000). Ver README para el flujo local.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
