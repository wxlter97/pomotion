import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev: `npm run dev` sirve el frontend (puerto por PORT env var, o 5173
// por defecto) y hace proxy de /api hacia `vercel dev` (típicamente :3000).
// Ver README para el flujo local.
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: false,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
