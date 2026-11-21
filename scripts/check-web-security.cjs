const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { resolve } = require('node:path');

(async () => {
  const probe = createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: resolve(__dirname, '../web'),
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'ignore', windowsHide: true,
  });
  const exited = new Promise(r => server.once('exit', r));
  try {
    let ready = false;
    for (let n = 0; n < 60; n++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(ready, 'Production web did not start');
    const nonces = new Set();
    for (const path of ['/', '/dashboard', '/']) {
      const response = await fetch(base + path, { headers: { 'Content-Security-Policy': "script-src 'unsafe-inline'", 'x-nonce': 'attacker' } });
      assert.equal(response.status, 200);
      const csp = response.headers.get('content-security-policy');
      const nonce = csp.match(/'nonce-([^']+)'/)[1];
      assert.ok(!nonces.has(nonce), 'Nonces must be fresh per request');
      nonces.add(nonce);
      assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const html = await response.text();
      const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
      assert.ok(scripts.length > 0);
      for (const [, attrs] of scripts) assert.ok(attrs.includes(`nonce="${nonce}"`), 'Framework and inline scripts must carry the CSP nonce');
    }
    console.log('Production web security checks passed: fresh CSP nonces on all scripts, no unsafe script policy, clickjacking protection, and private caching.');
    if (process.argv.includes('--serve')) {
      console.log('Browser verification URL: ' + base);
      await new Promise(r => { process.once('SIGINT', r); process.once('SIGTERM', r); });
    }
  } finally {
    server.kill();
    await exited;
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
