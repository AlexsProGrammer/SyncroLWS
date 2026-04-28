/**
 * Phase P — Auth helpers.
 *
 * Multi-user JWT model:
 *   - User JWTs (kind=`user`) are short-lived (default 8h) and minted via
 *     password login. They carry the user's `org_role` (`admin`|`member`)
 *     and a `scope` (`full` for normal use, `pw_change_only` when the user
 *     must change their password before continuing).
 *   - Device JWTs (kind=`device`) are long-lived (default 1y) and minted
 *     by an admin via `auth.devices.pair`. They authenticate sync traffic
 *     for a specific (user, profile) pair.
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

export type AuthKind = 'user' | 'device' | 'share';
export type OrgRole = 'admin' | 'member';
export type UserTokenScope = 'full' | 'pw_change_only';

export interface UserJwtPayload {
  kind: 'user';
  /** users.id (UUID) */
  sub: string;
  /** Cached org role for fast middleware checks; server still re-validates the
   *  user row on each request (revocation/disable). */
  org_role: OrgRole;
  /** `pw_change_only` tokens may invoke ONLY auth.changePassword. */
  scope: UserTokenScope;
  /** Random per-token id for future revocation lists. */
  jti: string;
}

export interface DeviceJwtPayload {
  kind: 'device';
  /** devices.id (UUID) */
  sub: string;
  /** users.id (UUID) of the user the device belongs to */
  user_id: string;
  profile_id: string;
}

export interface ShareJwtPayload {
  kind: 'share';
  /** share_links.id (UUID) */
  sub: string;
}

export type DecodedJwt = UserJwtPayload | DeviceJwtPayload | ShareJwtPayload;

// ── Auth context ──────────────────────────────────────────────────────────────

export type AuthContext =
  | { kind: 'anonymous' }
  | {
      kind: 'user';
      userId: string;
      orgRole: OrgRole;
      scope: UserTokenScope;
      email: string;
      displayName: string;
    }
  | { kind: 'device'; deviceId: string; userId: string; profileId: string }
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

export function signUserToken(
  userId: string,
  orgRole: OrgRole,
  scope: UserTokenScope = 'full',
): string {
  const payload: UserJwtPayload = {
    kind: 'user',
    sub: userId,
    org_role: orgRole,
    scope,
    jti: randomBytes(16).toString('hex'),
  };
  const ttl =
    scope === 'pw_change_only'
      ? env.PW_CHANGE_TOKEN_TTL_SECONDS
      : env.USER_TOKEN_TTL_SECONDS;
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ttl });
}

export function signPasswordChangeToken(userId: string, orgRole: OrgRole): string {
  return signUserToken(userId, orgRole, 'pw_change_only');
}

export function signDeviceToken(deviceId: string, userId: string, profileId: string): string {
  const payload: DeviceJwtPayload = {
    kind: 'device',
    sub: deviceId,
    user_id: userId,
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
    if (decoded.kind === 'user' || decoded.kind === 'device' || decoded.kind === 'share') {
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
