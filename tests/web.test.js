import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../scripts/web-server.js';

test('local server exposes app resources while rejecting writes, private files and untrusted hosts', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const redirect = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/renderer/site/index.html');
  const source = await fetch(`${base}/lib/github.js`);
  assert.equal(source.status, 200);
  assert.match(source.headers.get('content-type'), /javascript/);
  assert.match(source.headers.get('content-security-policy'), /https:\/\/api\.github\.com/);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/data/workspace.json`)).status, 404);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  assert.equal((await fetch(`${base}/lib/github.js`, { method: 'POST', body: 'overwrite' })).status, 403);
  const untrustedHostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/`, { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(untrustedHostStatus, 403);
  assert.equal((await fetch(`${base}/renderer/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/renderer/%E0%A4%A`)).status, 400);
});
