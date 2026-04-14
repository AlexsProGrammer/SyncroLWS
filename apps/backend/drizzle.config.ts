import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://syncrohws:syncrohws@localhost:5432/syncrohws',
  },
  verbose: true,
  strict: true,
});
