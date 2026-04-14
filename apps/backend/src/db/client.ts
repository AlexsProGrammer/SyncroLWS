import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://syncrohws:syncrohws@localhost:5432/syncrohws',
  max: 20,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
