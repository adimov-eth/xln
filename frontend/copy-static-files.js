#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, cpSync } from 'fs';
import { join, resolve } from 'path';

// Copy necessary files to static folder before build
// Note: server.js is built directly to static/ now (no copy needed)
const files = [
  { src: '../jurisdictions.json', dest: 'static/jurisdictions.json' },
  { src: '../jurisdictions/artifacts/contracts/Depository.sol/Depository.json', dest: 'static/contracts/Depository.json' }
];

for (const file of files) {
  const srcPath = resolve(file.src);
  const destPath = resolve(file.dest);

  if (existsSync(srcPath)) {
    // Create directory if needed
    const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
    mkdirSync(destDir, { recursive: true });

    copyFileSync(srcPath, destPath);
    console.log(`[OK] Copied ${file.src} [RIGHTWARDS] ${file.dest}`);
  } else {
    console.log(`[WARN] Source file not found: ${file.src}`);
  }
}

// Verify server.js exists (it should already be built there)
const serverJsPath = resolve('static/server.js');
if (existsSync(serverJsPath)) {
  console.log(`[OK] static/server.js exists (built directly)`);
} else {
  console.log(`[WARN] static/server.js missing - run 'bun run build' first`);
}

// Copy scenarios directory (skip if already symlinked)
const scenariosSrc = resolve('../scenarios');
const scenariosDest = resolve('static/scenarios');
try {
  const { lstatSync } = await import('fs');
  const stats = lstatSync(scenariosDest);
  if (stats.isSymbolicLink()) {
    console.log(`[INFO]  static/scenarios is symlinked - skipping copy`);
  } else {
    throw new Error('Not a symlink');
  }
} catch {
  // Not symlinked, do the copy
  if (existsSync(scenariosSrc)) {
    mkdirSync(scenariosDest, { recursive: true });
    cpSync(scenariosSrc, scenariosDest, { recursive: true });
    console.log(`[OK] Copied scenarios/ [RIGHTWARDS] static/scenarios/`);
  }
}

// Copy docs directory for DocsView
const docsSrc = resolve('../docs');
const docsDest = resolve('static/docs-static');
if (existsSync(docsSrc)) {
  mkdirSync(docsDest, { recursive: true });
  cpSync(docsSrc, docsDest, { recursive: true });
  console.log(`[OK] Copied docs/ [RIGHTWARDS] static/docs-static/`);
} else {
  console.log(`[WARN] Source directory not found: ${docsSrc}`);
}

console.log('[PKG] Static files copied for build');
