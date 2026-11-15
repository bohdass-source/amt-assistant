import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { MIGRATIONS } from './migrations';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  readonly pool = new Pool({ connectionString: env().DATABASE_URL, max: 10 });

  async onModuleInit() {
    await this.migrate();
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** API and worker start at the same time; an advisory lock keeps a migration from running twice. */
  private async migrate() {
    await this.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(727274)');
      await c.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      const { rows } = await c.query<{ id: number }>('SELECT id FROM schema_migrations');
      const applied = new Set(rows.map((r) => r.id));
      for (const m of MIGRATIONS) {
        if (applied.has(m.id)) continue;
        this.log.log(`Applying migration ${m.id}_${m.name}`);
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
      }
    });
  }
}
