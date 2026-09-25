import { Prisma } from '@prisma/client';

/**
 * The database's current time.
 *
 * Refresh token rotation times (`consumedAt`) are stamped with it and the
 * grace window is measured against it, so every backend instance reads
 * them on the same clock: an instance whose clock lags the one that rotated
 * a token would otherwise see the rotation in the future.
 */
export async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`
    SELECT clock_timestamp() AS "now"`;
  return rows[0].now;
}
