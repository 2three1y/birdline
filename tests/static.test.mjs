// Site rules checked on the files themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function walk(d, out = []) { for (const f of readdirSync(d)) { if (f.startsWith('.') || f === 'node_modules') continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }
const files = walk(root).filter(p => /\.(html|js|css|json|webmanifest|md|svg)$/.test(p));

test('html basics', () => {
  assert.match(html, /<html lang="en-US">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1 (each view changes its text)');
  assert.equal((html.match(/aria-live=/g) || []).length, 1, 'one live region');
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /Co-written with Tab/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /maximum-scale|user-scalable=no/, 'zoom stays on');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
});

test('app code adds no second h1 or live region', () => {
  for (const f of files.filter(p => p.endsWith('.js') && !p.includes('vendor'))) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /el\('h1'/, f);
    assert.doesNotMatch(s, /aria-live|'role': 'alert'|role: 'alert'/, f);
    assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|document\.write/, f + ' must not inject HTML');
  }
});

test('no CDNs or remote scripts', () => {
  for (const f of files.filter(p => p.endsWith('.html') || p.endsWith('.css'))) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /<script[^>]+src="https?:/, f);
    assert.doesNotMatch(s, /<link[^>]+href="https?:/, f);
    assert.doesNotMatch(s, /@import\s+url\(["']?https?:/, f);
  }
});

test('word rules', () => {
  const banned = [String.fromCharCode(98, 108, 105, 110, 100)]; // kept out of the source on purpose
  for (const f of files) {
    const s = readFileSync(f, 'utf8').toLowerCase();
    for (const w of banned) assert.ok(!new RegExp(`\\b${w}`).test(s), `${f} contains a banned word`);
    if (!f.includes('vendor') && !f.endsWith('README.md') && !f.includes('docs')) assert.doesNotMatch(s, /twitter|tweet/, `${f} uses the original's name`);
  }
});

test('every app import carries the same cache version', () => {
  const versions = new Set();
  for (const f of ['index.html', ...readdirSync(join(root, 'js')).map(x => 'js/' + x)]) {
    const s = readFileSync(join(root, f), 'utf8');
    for (const m of s.matchAll(/(?:from |import\(|src="|href="|URL\()['"]?((?:\.\.?\/|js\/|css\/)[\w./-]+\.(?:js|css))(\?v=[\w.]+)?/g)) {
      assert.ok(m[2], `${f}: ${m[1]} has no ?v=`); versions.add(m[2]);
    }
  }
  assert.equal(versions.size, 1, [...versions].join(' '));
});
