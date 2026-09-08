import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * A single postgres.js connection factory, shared by the migration runner
 * and the app's Drizzle client. There is deliberately no Drizzle schema
 * module yet -- Phase 1A's first increment only needs to prove the app can
 * connect and that the reference schema applies cleanly. Entity definitions
 * arrive with the tenancy/auth increment that actually queries these tables.
 */
export function createDbConnection(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql);
  return { sql, db };
}
