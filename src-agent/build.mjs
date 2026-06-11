import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/main.bundle.mjs',
  external: ['node:*'],
  banner: {
    js: `import{createRequire as __cr}from'node:module';import{fileURLToPath as __ftp}from'node:url';var require=__cr(__ftp(import.meta.url));
// Auto-bundled by esbuild — no node_modules needed at runtime`,
  },
});

console.log('sidecar bundle built → dist/main.bundle.mjs');
