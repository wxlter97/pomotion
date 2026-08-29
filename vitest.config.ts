import { defineConfig } from 'vitest/config';

// Config dedicada de Vitest (Vitest la prefiere sobre vite.config.ts). Los
// tests cubren solo lógica pura —parseo de duración/hora y de texto de
// Notion— así que no hace falta el plugin de React ni un entorno DOM.
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
