import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDbConnection } from './client';

export const DB_CONNECTION = Symbol('DB_CONNECTION');
export const PG_CONNECTION = Symbol('PG_CONNECTION');
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

/**
 * Global module exposing one shared postgres.js connection pool: the raw
 * client (for health checks and, later, `SET LOCAL app.tenant_id` per
 * request per tenancy-and-security.md) and the Drizzle instance built on
 * top of the *same* pool -- not a second pool, which is why this is wired
 * through one factory rather than two independent ones.
 *
 * Implements OnModuleDestroy to actually close the pool on app shutdown --
 * without this, the open socket keeps the process alive after `app.close()`
 * (visible as Jest's "did not exit" warning in tests).
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createDbConnection(config.getOrThrow<string>('DATABASE_URL')),
    },
    {
      provide: PG_CONNECTION,
      inject: [DB_CONNECTION],
      useFactory: (conn: ReturnType<typeof createDbConnection>) => conn.sql,
    },
    {
      provide: DRIZZLE_DB,
      inject: [DB_CONNECTION],
      useFactory: (conn: ReturnType<typeof createDbConnection>) => conn.db,
    },
  ],
  exports: [PG_CONNECTION, DRIZZLE_DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(
    @Inject(DB_CONNECTION)
    private readonly conn: ReturnType<typeof createDbConnection>,
  ) {}

  async onModuleDestroy() {
    await this.conn.sql.end();
  }
}
