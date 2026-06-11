import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/main.bundle.js',
  external: ['node:*'],
  banner: {
    js: '// Auto-bundled by esbuild — no node_modules needed at runtime',
  },
});

console.log('sidecar bundle built → dist/main.bundle.js');
