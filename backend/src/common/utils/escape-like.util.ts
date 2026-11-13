/**
 * Escape the LIKE/ILIKE wildcards in a user-supplied search term so `%`, `_`
 * and the escape character itself match literally. Postgres LIKE uses
 * backslash as its default escape character; Prisma binds the term into the
 * pattern, so `%` otherwise widens the search to every row.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
