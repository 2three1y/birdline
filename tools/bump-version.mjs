// Cache-busting for GitHub Pages (it caches files for 10 minutes): stamps one version on every app import.
// Usage: node tools/bump-version.mjs 0.1.2
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const v = process.argv[2]; if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.error('usage: node tools/bump-version.mjs X.Y.Z'); process.exit(1); }
const files = ['index.html', ...readdirSync('js').map(f => 'js/' + f)];
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  s = s.replace(/((?:\.\.?\/|js\/|css\/)[\w./-]+\.(?:js|css))(\?v=[\w.]+)?(['"])/g, `$1?v=${v}$3`);
  s = s.replace(/version: '[\d.]+'/, `version: '${v}'`);
  writeFileSync(f, s);
}
console.log('stamped', v, 'on', files.length, 'files');
