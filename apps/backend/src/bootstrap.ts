/**
 * Phase H — Owner bootstrap.
 *
 * On startup, if the `owner` table is empty AND OWNER_BOOTSTRAP_EMAIL +
 * OWNER_BOOTSTRAP_PASSWORD are set, seed exactly one row. Subsequent
 * restarts log a warning and exit if the table is empty without bootstrap
 * credentials — the backend cannot serve protected routes without an owner.
 */
import { db } from './db/client';
import { owner } from './db/schema';
import { hashPassword } from './auth';
import { env } from './config/env';

export async function bootstrapOwner(): Promise<void> {
  const existing = await db.select({ id: owner.id }).from(owner).limit(1);
  if (existing.length > 0) return;

  if (!env.OWNER_BOOTSTRAP_EMAIL || !env.OWNER_BOOTSTRAP_PASSWORD) {
    console.error(
      '\n[backend] No owner row exists and OWNER_BOOTSTRAP_EMAIL/PASSWORD are not set.\n' +
      '         Set them in .env to seed the owner on first startup, then restart.\n',
    );
    process.exit(1);
  }

  const hash = await hashPassword(env.OWNER_BOOTSTRAP_PASSWORD);
  await db.insert(owner).values({
    email: env.OWNER_BOOTSTRAP_EMAIL,
    password_hash: hash,
  });
  console.log(`[backend] Seeded owner row for ${env.OWNER_BOOTSTRAP_EMAIL}`);
}
