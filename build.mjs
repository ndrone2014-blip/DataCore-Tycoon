// Build script: bundles src/main.ts into dist/game.js (IIFE, runs from file:// too).
import { build, context } from 'esbuild';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = `${pkg.version}`;
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
// cache-bust the script tag so browsers always load the newest build
const html = readFileSync('index.html', 'utf8').replace(/dist\/game\.js(\?v=[^"]*)?"/, `dist/game.js?v=${version}-${Date.now().toString(36)}"`)
  .replace(/styles\/main\.css(\?v=[^"]*)?"/, `styles/main.css?v=${version}-${Date.now().toString(36)}"`);
writeFileSync('index.html', html);
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
  define: { __GAME_VERSION__: JSON.stringify(`v${version} · ${stamp} UTC`) },
};
if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('Watching for changes…');
} else {
  await build(opts);
}
