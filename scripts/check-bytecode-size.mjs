#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 24576;
const root = process.cwd();
const artifactsRoot = path.join(root, 'jurisdictions', 'artifacts', 'contracts');

const targets = [
  ['Depository', path.join(artifactsRoot, 'Depository.sol', 'Depository.json')],
  ['EntityProvider', path.join(artifactsRoot, 'EntityProvider.sol', 'EntityProvider.json')],
];

const bytesOf = (hex) => {
  const clean = (hex || '').replace(/^0x/, '');
  return clean.length / 2;
};

let failed = false;
for (const [name, file] of targets) {
  if (!fs.existsSync(file)) {
    console.error(`❌ Missing artifact for ${name}: ${file}`);
    failed = true;
    continue;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(raw);
  const bytes = bytesOf(json.deployedBytecode);
  const status = bytes <= LIMIT ? '✅' : '❌';
  console.log(`${status} ${name}: ${bytes} bytes (limit ${LIMIT})`);
  if (bytes > LIMIT) failed = true;
}

if (failed) {
  process.exit(1);
}
