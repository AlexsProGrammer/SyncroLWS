/**
 * Phase H — Auth helpers.
 *
 * Single-owner JWT model:
 *   - Owner JWTs (kind=`owner`) are short-lived (default 1h) and minted via
 *     password login. They allow management ops: list/pair/revoke devices,
 *     create share links.
 *   - Device JWTs (kind=`device`) are long-lived (default 1y) and minted by
 *     the owner via `auth.devices.pair`. They authenticate sync traffic.
 *   - Share JWTs (kind=`share`) — Phase M. Reserved here.
 *
 * The raw token is never stored. For device tokens we keep a SHA-256 hash so
 * revocation is enforced even before the JWT expires.
 */
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './config/env';

// ── JWT payloads ──────────────────────────────────────────────────────────────

export type AuthKind = 'owner' | 'device' | 'share';

export interface OwnerJwtPayload {
  kind: 'owner';
  /** owner.id (UUID) */
  sub: string;
  /** UUID generated per-token to allow future revocation lists. */
  jti: string;
}

export interface DeviceJwtPayload {
  kind: 'device';
  /** devices.id (UUID) */
  sub: string;
  /** owner.id (UUID) */
  owner_id: string;
  profile_id: string;
}

export interface ShareJwtPayload {
  kind: 'share';
  /** share_links.id (UUID) */
  sub: string;
}

export type DecodedJwt = OwnerJwtPayload | DeviceJwtPayload | ShareJwtPayload;

// ── Auth context ──────────────────────────────────────────────────────────────

export type AuthContext =
  | { kind: 'anonymous' }
  | { kind: 'owner'; ownerId: string }
  | { kind: 'device'; deviceId: string; ownerId: string; profileId: string }
  | { kind: 'share'; shareId: string };

// ── Password hashing ──────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── JWT signing / verification ────────────────────────────────────────────────

export function signOwnerToken(ownerId: string): string {
  const payload: OwnerJwtPayload = {
    kind: 'owner',
    sub: ownerId,
    jti: randomBytes(16).toString('hex'),
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.OWNER_TOKEN_TTL_SECONDS });
}

export function signDeviceToken(deviceId: string, ownerId: string, profileId: string): string {
  const payload: DeviceJwtPayload = {
    kind: 'device',
    sub: deviceId,
    owner_id: ownerId,
    profile_id: profileId,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.DEVICE_TOKEN_TTL_SECONDS });
}

export function signShareToken(shareId: string, expiresInSeconds?: number): string {
  const payload: ShareJwtPayload = { kind: 'share', sub: shareId };
  return jwt.sign(
    payload,
    env.JWT_SECRET,
    expiresInSeconds ? { expiresIn: expiresInSeconds } : {},
  );
}

export function verifyToken(token: string): DecodedJwt | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { kind?: string };
    if (decoded.kind === 'owner' || decoded.kind === 'device' || decoded.kind === 'share') {
      return decoded as unknown as DecodedJwt;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Token hashing (for revocation tracking) ──────────────────────────────────

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Header parsing helper ────────────────────────────────────────────────────

export function parseBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m && m[1] ? m[1].trim() : null;
}
