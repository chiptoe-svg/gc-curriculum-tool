import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'lib/**/__tests__/**/*.test.ts',
      'lib/**/__tests__/**/*.test.tsx',
      'app/**/__tests__/**/*.test.ts',
      'app/**/__tests__/**/*.test.tsx',
      'components/**/__tests__/**/*.test.ts',
      'components/**/__tests__/**/*.test.tsx',
    ],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './') },
  },
});
