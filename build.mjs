// Build script: bundles src/main.ts into dist/game.js (IIFE, runs from file:// too).
import { build, context } from 'esbuild';
const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/game.js',
  sourcemap: true,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
};
if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('Watching for changes…');
} else {
  await build(opts);
}
