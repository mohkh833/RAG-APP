import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // The backend has its own Jest suite; without this, Vitest walks into
    // ../src and tries to run it.
    include: ['{app,components,lib,__tests__}/**/*.{test,spec}.{ts,tsx}'],
  },
});
