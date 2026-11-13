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

test('the docs say one person with several addresses can close the corrections form, with the numbers the code uses', () => {
  const src = read('src/index.js');
  const cap = (name) => Number(src.match(new RegExp(`^const ${name} = (\\d+);`, 'm'))[1]);
  const perAddress = cap('CORRECTIONS_PER_CLIENT_DAY');
  const hourly = Math.ceil(cap('CORRECTIONS_PER_HOUR') / perAddress);
  const daily = Math.ceil(cap('CORRECTIONS_PER_DAY') / perAddress);
  for (const f of ['docs/handoff.md', 'docs/update-workflow.md', 'src/lib/client.js', 'src/index.js']) {
    const text = read(f).replace(/\n\s*(\/\/ )?/g, ' ');
    assert.match(text, /not a person|addresses, not people/, `${f}: an address is not a person`);
    assert.match(text, /\/48 or \/56/, `${f}: one person can hold many /64s`);
    assert.match(text, /\bTor\b/, f);
    assert.doesNotMatch(text, /many addresses together|Many senders at once/i, f);
  }
  for (const f of ['docs/handoff.md', 'docs/update-workflow.md']) {
    assert.match(read(f).replace(/\s+/g, ' '), new RegExp(`${hourly} addresses fill the hourly cap and ${daily} the daily one`), f);
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
