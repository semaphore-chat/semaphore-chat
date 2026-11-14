import { InstanceRole } from '@prisma/client';
import { createE2eApp, resetDatabase, E2eApp } from './helpers/e2e-app';
import { DatabaseService } from '@/database/database.service';
import { UserService } from '@/user/user.service';

/**
 * User search terms reach Postgres as ILIKE patterns (Prisma `contains` and
 * insensitive `equals`), where `%` and `_` are wildcards. Against the real
 * database: `_` and `%` in a term match only themselves, and a name with a
 * literal `_` is still found (so the terms are escaped exactly once).
 */
describe('User search wildcards (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let users: UserService;
  let ownerId: string;

  const searchNames = async (q: string) =>
    (
      await users.searchUsers(q, undefined, 50, {
        id: ownerId,
        role: InstanceRole.OWNER,
      })
    )
      .map((u) => u.username)
      .sort();
  const adminSearchNames = async (search: string) =>
    (await users.findAllAdmin(50, undefined, { search })).users
      .map((u) => u.username)
      .sort();

  beforeAll(async () => {
    app = await createE2eApp();
    db = app.get(DatabaseService);
    users = app.get(UserService);
    await resetDatabase(app);
    ownerId = (
      await db.user.create({
        data: { username: 'wc-owner', hashedPassword: 'x', role: 'OWNER' },
      })
    ).id;
    for (const username of ['a_b', 'axb', 'pct%name', 'back\\slash']) {
      await db.user.create({
        data: { username, hashedPassword: 'x', role: 'USER' },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('a search for a_b finds only a_b, not axb (the _ is not a wildcard)', async () => {
    expect(await searchNames('a_b')).toEqual(['a_b']);
    expect(await adminSearchNames('a_b')).toEqual(['a_b']);
  });

  it('a search for % matches only names containing a literal %', async () => {
    expect(await searchNames('%')).toEqual(['pct%name']);
    expect(await adminSearchNames('%')).toEqual(['pct%name']);
  });

  it('a search for _ matches only names containing a literal _', async () => {
    expect(await searchNames('_')).toEqual(['a_b']);
    expect(await adminSearchNames('_')).toEqual(['a_b']);
  });

  it('finds a name with a literal _ or \\ by a part of it', async () => {
    expect(await searchNames('A_')).toEqual(['a_b']);
    expect(await searchNames('k\\s')).toEqual(['back\\slash']);
    expect(await adminSearchNames('_B')).toEqual(['a_b']);
  });

  it('the case-insensitive username conflict check treats _ literally', async () => {
    // With a_b gone, a_b must not conflict with axb through the wildcard
    await expect(users.checkForFieldConflicts('A_B')).rejects.toThrow(
      /username/,
    );
    await db.user.delete({ where: { username: 'a_b' } });
    await expect(users.checkForFieldConflicts('a_b')).resolves.toBeUndefined();
    await expect(users.checkForFieldConflicts('AXB')).rejects.toThrow(
      /username/,
    );
  });
});
