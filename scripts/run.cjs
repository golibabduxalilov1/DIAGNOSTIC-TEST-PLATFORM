const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw Error('Rejim: dev yoki start.');
for (const dir of ['api', 'web']) {
  if (!existsSync(resolve(root, dir, '.env')) || !existsSync(resolve(root, dir, 'node_modules'))) {
    console.error('Avval npm run setup bajaring.');
    process.exit(1);
  }
}
if (mode === 'start' && (!existsSync(resolve(root, 'api/dist/main.js')) || !existsSync(resolve(root, 'web/.next/BUILD_ID')))) {
  console.error('Avval npm run build bajaring.');
  process.exit(1);
}
const services = [
  ['api', mode === 'dev' ? ['--import', 'tsx', '--watch', 'src/main.ts'] : ['dist/main.js']],
  ['web', ['node_modules/next/dist/bin/next', mode, '--hostname', '127.0.0.1']]
];
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const [dir, args] of services) {
  const child = spawn(process.execPath, args, { cwd: resolve(root, dir), stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
console.log('Sayt: http://127.0.0.1:3000 | Admin: http://127.0.0.1:3000/dashboard | To‘xtatish: Ctrl+C');
