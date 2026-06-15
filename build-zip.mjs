// ============================================================
//  Build a Web Store-ready zip of the extension.
//  Usage:  node build-zip.mjs   →   dist/privacy-auditor-<version>.zip
//  Bundles only the files Chrome needs; dev files are excluded.
// ============================================================
import { mkdirSync, readFileSync, statSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = import.meta.dirname;
const { version } = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// Everything the packed extension actually needs at runtime.
const INCLUDE = [
  'manifest.json',
  'background.js',
  'content.js',
  'injected.js',
  'popup.html', 'popup.js', 'popup.css',
  'options.html', 'options.js', 'options.css',
  'lib',     // scoring.js
  'icons',
  'LICENSE',
];

// Collect files (expand directories recursively).
function collect(entry) {
  const abs = join(ROOT, entry);
  let st;
  try { st = statSync(abs); } catch { return []; }
  if (st.isFile()) return [entry];
  if (st.isDirectory()) {
    return readdirSync(abs).flatMap(child => collect(join(entry, child)));
  }
  return [];
}

const files = INCLUDE.flatMap(collect);
if (!files.includes('manifest.json')) {
  console.error('manifest.json missing — aborting.');
  process.exit(1);
}

const distDir = join(ROOT, 'dist');
mkdirSync(distDir, { recursive: true });
const outName = `privacy-auditor-${version}.zip`;
const outPath = join(distDir, outName);

// Stage files into a temp folder, preserving directory structure. Zipping a
// flat file list would strip the lib/ and icons/ folders, breaking manifest
// paths like "lib/scoring.js" once installed.
const stageDir = join(distDir, '_stage');
rmSync(stageDir, { recursive: true, force: true });
for (const f of files) {
  const src = join(ROOT, f);
  const dst = join(stageDir, f);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

try {
  rmSync(outPath, { force: true });
  if (process.platform === 'win32') {
    // Zip the staged tree's CONTENTS (trailing \*) so paths stay relative.
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Force -DestinationPath '${outPath}' -Path '${join(stageDir, '*')}'`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', outPath, '.'], { cwd: stageDir, stdio: 'inherit' });
  }
} catch (err) {
  console.error('Packaging failed:', err.message);
  process.exit(1);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}

console.log(`\n✓ Built dist/${outName}`);
console.log(`  ${files.length} entries, version ${version}`);
