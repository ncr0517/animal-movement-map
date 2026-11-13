// What the docs tell the owner to run must match the code: the Node version the tests need, and the deploy order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './helpers/d1.js';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('the documented Node version is the one the test helper needs (node:sqlite unflagged, StatementSync.columns)', () => {
  // columns() was added in Node 22.16 (and 23.11); node:sqlite needs no flag from 22.13.
  assert.equal(typeof new DatabaseSync(':memory:').prepare('SELECT 1').columns, 'function');
  assert.equal(JSON.parse(read('package.json')).engines?.node, '>=22.16');
  for (const f of ['README.md', 'docs/handoff.md']) {
    assert.match(read(f), /Node 22\.16 or later/, f);
    assert.doesNotMatch(read(f), /Node 22\.5\b/, f);
  }
});

test('the deploy steps upload the Worker before reloading the database', () => {
  for (const f of ['README.md', 'docs/handoff.md']) {
    const text = read(f);
    const deploy = text.search(/^(npm run deploy|npx wrangler deploy)\b/m);
    const reseed = text.search(/^npm run db:remote\b/m);
    assert.ok(deploy >= 0 && reseed >= 0, `${f}: both steps are listed`);
    assert.ok(deploy < reseed, `${f}: deploy comes before db:remote`);
  }
});
