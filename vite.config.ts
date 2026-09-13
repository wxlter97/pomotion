import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev: `npm run dev` sirve el frontend (puerto por PORT env var, o 5173
// por defecto) y hace proxy de /api hacia `vercel dev` (típicamente :3000).
// Ver README para el flujo local.
const port = Number(process.env.PORT) || 5173;

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
) as { version: string };

export default defineConfig({
  plugins: [react()],
  // Versión mostrada en el diálogo "Acerca de" (ver AboutDialog.tsx) —
  // tomada de package.json en build time, no hace falta duplicarla a mano.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port,
    strictPort: false,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
