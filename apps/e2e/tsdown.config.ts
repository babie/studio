import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['claude-linear.ts', 'claude-github.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  dts: false,
  clean: true,
});
