#!/usr/bin/env node
/**
 * Starts API (3001) + Vite (5173) together for local development.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, name) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return child;
}

const api = run('node', ['server/index.js'], 'api');
const web = run('npx', ['vite', '--host', '--port', '5173'], 'vite');

function shutdown() {
  api.kill();
  web.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
