/**
 * Phase P — Admin user bootstrap.
 *
 * On startup, if the `users` table is empty AND OWNER_BOOTSTRAP_EMAIL +
 * OWNER_BOOTSTRAP_PASSWORD are set, seed exactly one admin user. Subsequent
 * restarts log a warning and exit if the table is empty without bootstrap
 * credentials — the backend cannot serve protected routes without an admin.
 *
 * The bootstrapped admin's `must_change_password` is FALSE: we trust whoever
 * provisioned `OWNER_BOOTSTRAP_PASSWORD` set a strong value. Subsequent users
 * created via `auth.users.create` get must_change_password=true.
 */
import { db } from './db/client';
import { users } from './db/schema';
import { hashPassword } from './auth';
import { env } from './config/env';

export async function bootstrapAdmin(): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return;

  if (!env.OWNER_BOOTSTRAP_EMAIL || !env.OWNER_BOOTSTRAP_PASSWORD) {
    console.error(
      '\n[backend] No users exist and OWNER_BOOTSTRAP_EMAIL/PASSWORD are not set.\n' +
      '         Set them in .env to seed the first admin on first startup, then restart.\n',
    );
    process.exit(1);
  }

  const hash = await hashPassword(env.OWNER_BOOTSTRAP_PASSWORD);
  await db.insert(users).values({
    email: env.OWNER_BOOTSTRAP_EMAIL,
    password_hash: hash,
    display_name: env.OWNER_BOOTSTRAP_EMAIL,
    org_role: 'admin',
    must_change_password: false,
  });
  console.log(`[backend] Seeded admin user for ${env.OWNER_BOOTSTRAP_EMAIL}`);
}

/** @deprecated Phase P — old name retained for index.ts callsite compat. */
export const bootstrapOwner = bootstrapAdmin;
