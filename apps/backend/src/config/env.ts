import { z } from 'zod';

/**
 * Strict environment variable validation.
 * The backend MUST crash immediately on startup if any required variable
 * is missing or malformed — fail-fast principle.
 */
const envSchema = z.object({
  // ── Required ────────────────────────────────────────────────────────────────
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid PostgreSQL connection string')
    .startsWith('postgresql://', 'DATABASE_URL must use the postgresql:// scheme'),

  MINIO_URL: z
    .string()
    .url('MINIO_URL must be a valid URL (e.g. http://localhost:9000)'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for adequate security'),

  // ── Optional with defaults ──────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(3000),

  POWERSYNC_URL: z
    .string()
    .url('POWERSYNC_URL must be a valid URL')
    .optional()
    .default('http://localhost:8080'),

  MINIO_BUCKET: z.string().default('syncrohws-files'),
  MINIO_ACCESS_KEY: z.string().default('syncrohws'),
  MINIO_SECRET_KEY: z.string().default('syncrohws_secret'),

  // ── Owner bootstrap (used only if `owner` table empty on startup) ───────────
  OWNER_BOOTSTRAP_EMAIL: z.string().email().optional(),
  OWNER_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),

  // ── Token lifetimes (seconds) ──────────────────────────────────────────────
  OWNER_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),         // 1h
  DEVICE_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 365), // 1y
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(
      '\n╔══════════════════════════════════════════════════════════╗\n' +
      '║        ENVIRONMENT VALIDATION FAILED — ABORTING         ║\n' +
      '╚══════════════════════════════════════════════════════════╝\n\n' +
      `${formatted}\n\n` +
      'Ensure all required variables are set in your .env file.\n',
    );

    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
