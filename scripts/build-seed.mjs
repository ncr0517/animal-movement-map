// Build the D1 seed + a static snapshot from the research files (logic in scripts/lib/seed.mjs).
// Outputs: db/seed.sql, public/snapshot.json, data/seed/build-report.md
//
// The build stops (exit 1) without writing anything when an input file cannot be read or parsed, or when it
// would publish far fewer entities or events than the committed db/seed.sql. Set ALLOW_SHRINK=1 when a
// large removal is intended.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readInputs, buildSeed, seedSql, staticSnapshot, buildReport, seedCounts, shrinkProblems } from './lib/seed.mjs';

const R = (...p) => path.join(ROOT, ...p);

try {
  const result = buildSeed(readInputs(ROOT));
  const now = new Date().toISOString();
  const sql = seedSql(result, now);

  const seedPath = R('db/seed.sql');
  const prev = fs.existsSync(seedPath) ? seedCounts(fs.readFileSync(seedPath, 'utf8')) : null;
  const problems = shrinkProblems(prev, seedCounts(sql));
  if (problems.length && process.env.ALLOW_SHRINK !== '1') {
    throw new Error(`This build would drop a lot of records (${problems.join('; ')}). Check data/research for a missing or emptied ` +
      'file. If the removal is intended, run it again with ALLOW_SHRINK=1.');
  }

  fs.writeFileSync(seedPath, sql);
  fs.writeFileSync(R('public/snapshot.json'), JSON.stringify(staticSnapshot(result, now)));
  const report = buildReport(result, now);
  fs.mkdirSync(R('data/seed'), { recursive: true });
  fs.writeFileSync(R('data/seed/build-report.md'), report);
  console.log(report.split('\n## Reconciled')[0]);
  console.log(`warnings: ${result.warnings.length}, merges: ${result.merges.length}, stubs: ${result.stubs.length}`);
} catch (err) {
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
}
