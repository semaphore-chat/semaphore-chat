import { Prisma } from '@prisma/client';

/**
 * Row locks on the user that serialize refresh token rotation with the
 * revocation of the user's sessions (logout, revoke session, password reset).
 *
 * Without them, a revocation that deletes refresh tokens while a refresh is
 * rotating one misses the token the refresh inserts: the delete waits for the
 * row the refresh consumed, but under READ COMMITTED it only deletes rows its
 * statement could see when it started. The rotated token would outlive the
 * revocation.
 *
 * With them, whichever transaction locks the user row first goes first. A
 * refresh that comes second no longer finds its token. A revocation that
 * comes second deletes with a statement that starts after the refresh
 * committed, so it sees (and deletes) the token the refresh inserted.
 *
 * Refreshes and logins take a shared lock, so they don't wait for each
 * other. Logins take it too: a login that checked the old password must not
 * insert a token after a password reset deleted the user's tokens.
 */

/**
 * Lock the user for a refresh token rotation (shared). Call first in the
 * rotation's transaction.
 * @returns The user's ban flag, or null if the user no longer exists
 */
export async function lockUserForTokenRotation(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ banned: boolean } | null> {
  const rows = await tx.$queryRaw<{ banned: boolean }[]>`
    SELECT "banned" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  return rows[0] ?? null;
}

/**
 * Lock the user for a login (shared, like a rotation): a password reset
 * either completes before the login issues its tokens, or waits for the
 * login to commit and then deletes them.
 * @returns The user's current password hash (compare it with the one the
 *   login checked), or null if the user no longer exists
 */
export async function lockUserForLogin(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ hashedPassword: string } | null> {
  const rows = await tx.$queryRaw<{ hashedPassword: string }[]>`
    SELECT "hashedPassword" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  return rows[0] ?? null;
}

/**
 * Lock a refresh token for its rotation (exclusive). Concurrent refreshes
 * with the same token (tabs sharing a cookie) then run one after the other:
 * the first rotates it, the others see it consumed and get the same
 * successor (see RefreshTokenGraceService). Take it after the user lock.
 */
export async function lockRefreshToken(
  tx: Prisma.TransactionClient,
  tokenId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "RefreshToken" WHERE "id" = ${tokenId} FOR UPDATE`;
}

/**
 * Lock the user for a revocation of their sessions (exclusive against
 * rotations). Call in the revocation's transaction before it reads or
 * deletes refresh tokens.
 */
export async function lockUserForSessionRevocation(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
}
