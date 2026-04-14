import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://syncrohws:syncrohws@localhost:5434/syncrohws',
  },
  verbose: true,
  // strict: true would prompt before destructive changes — omit for automated push
});
