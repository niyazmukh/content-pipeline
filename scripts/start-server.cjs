#!/usr/bin/env node
// Start server helper: load dotenv then compile TS server and run it.
try {
  require('dotenv').config({ path: '.env.local' });
} catch (e) {
  // ignore
}

const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('node:child_process');

execSync('npx tsc -p tsconfig.server.json', { stdio: 'inherit' });

const distDir = path.join(process.cwd(), 'dist', 'server');
const distEntry = path.join(distDir, 'index.js');

try {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
} catch (error) {
  // ignore
}

const child = spawn(process.execPath, [distEntry], {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

child.on('error', () => process.exit(1));

