import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import postgres from 'postgres';

/**
 * Applies the reference schema files in docs/architecture/schema/*.sql as
 * real migrations. Those files are the single source of truth for the data
 * model (see docs/architecture/schema/README.md) -- this script runs them
 * as-is rather than maintaining a second, duplicated copy under the app.
 *
 * Tracks what has already run in a `_migrations` table so this is safe to
 * re-run: already-applied files are skipped, not re-executed.
 */

const SCHEMA_DIR = path.join(
  __dirname,
  '../../../../docs/architecture/schema',
);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  }

  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .sql files found in ${SCHEMA_DIR}`);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    // The RLS migration's DO block emits a NOTICE for every "drop policy if
    // exists" that has nothing to drop yet (expected on a first run) --
    // silence those so real output stays readable.
    onnotice: () => {},
  });

  try {
    await sql`
      create table if not exists _migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      )
    `;

    const appliedRows = await sql<{ filename: string }[]>`
      select filename from _migrations
    `;
    const applied = new Set(appliedRows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }

      const contents = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');

      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`insert into _migrations (filename) values (${file})`;
      });

      console.log(`applied ${file}`);
    }

    console.log('Migrations up to date.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
