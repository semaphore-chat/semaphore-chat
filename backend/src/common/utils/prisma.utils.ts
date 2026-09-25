import { Prisma } from '@prisma/client';

/**
 * Type guard for Prisma known request errors.
 * Checks instanceof first, then falls back to duck-typing for
 * compatibility with test mocks and serialized errors.
 */
export function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === code;
  }
  return (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}
