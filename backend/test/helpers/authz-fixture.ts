/**
 * Shared setup for the authorization e2e suites: named users, a fresh community
 * per test (so one test's role edits can't affect another), and role helpers.
 * The first name becomes InstanceRole.OWNER, the instance owner who sets up the
 * scene; everyone else is a plain user until a test gives them a role.
 */
import * as request from 'supertest';
import { RbacActions } from '@prisma/client';
import { DatabaseService } from '@/database/database.service';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './e2e-app';

export interface TestCommunity {
  id: string;
  adminRole: string;
  modRole: string;
  memberRole: string;
  generalChannel: string;
}

export interface AuthzFixture<Who extends string> {
  app: E2eApp;
  db: DatabaseService;
  id: Record<Who, string>;
  /** A supertest agent, plus `as(who)` to set the caller's token. */
  http: () => ReturnType<typeof request>;
  bearer: (who: Who) => string;
  community: () => Promise<TestCommunity>;
  join: (communityId: string, ...who: Who[]) => Promise<void>;
  give: (communityId: string, who: Who, roleId: string) => Promise<void>;
  customRole: (
    communityId: string,
    position: number,
    actions: RbacActions[],
    name?: string,
  ) => Promise<string>;
  instanceRole: (name: string) => Promise<string>;
  giveInstance: (who: Who, roleId: string) => Promise<void>;
}

let counter = 0;
export const unique = (prefix: string) =>
  `${prefix}-${++counter}-${Date.now()}`;

export async function authzFixture<Who extends string>(
  prefix: string,
  names: readonly [Who, ...Who[]],
): Promise<AuthzFixture<Who>> {
  const app = await createE2eApp();
  const db = app.get(DatabaseService);
  await resetDatabase(app);
  await seedInstanceInvite(app);

  const id = {} as Record<Who, string>;
  const token = {} as Record<Who, string>;
  for (const who of names) {
    const creds = {
      username: `${prefix}-${who}`.toLowerCase(),
      password: 'Password123!',
    };
    id[who] = (await registerUser(app, creds)).id;
    token[who] = (
      await loginUser(app, creds.username, creds.password)
    ).accessToken;
  }

  const owner = names[0];
  const http = () => request(app.getHttpServer());
  const bearer = (who: Who) => `Bearer ${token[who]}`;

  const join = async (communityId: string, ...who: Who[]) => {
    for (const w of who) {
      await http()
        .post('/api/membership')
        .set('Authorization', bearer(owner))
        .send({ userId: id[w], communityId })
        .expect(201);
    }
  };

  const give = async (communityId: string, who: Who, roleId: string) => {
    await http()
      .post(`/api/roles/community/${communityId}/assign`)
      .set('Authorization', bearer(owner))
      .send({ userId: id[who], roleId })
      .expect(204);
  };

  return {
    app,
    db,
    id,
    http,
    bearer,
    join,
    give,
    community: async () => {
      const res = await http()
        .post('/api/community')
        .set('Authorization', bearer(owner))
        .send({ name: unique('community'), description: 'e2e' })
        .expect(201);
      const communityId = (res.body as { id: string }).id;
      const roles = await db.role.findMany({ where: { communityId } });
      const byName = (name: string) => roles.find((r) => r.name === name)!.id;
      const general = await db.channel.findFirstOrThrow({
        where: { communityId, name: 'general' },
      });
      return {
        id: communityId,
        adminRole: byName('Community Admin'),
        modRole: byName('Moderator'),
        memberRole: byName('Member'),
        generalChannel: general.id,
      };
    },
    customRole: async (communityId, position, actions, name) =>
      (
        await db.role.create({
          data: {
            name: name ?? unique('role'),
            communityId,
            position,
            actions,
          },
        })
      ).id,
    instanceRole: async (name) =>
      (
        await db.role.findFirstOrThrow({
          where: { name, communityId: null },
        })
      ).id,
    giveInstance: async (who, roleId) => {
      await http()
        .post(`/api/roles/instance/${roleId}/assign`)
        .set('Authorization', bearer(owner))
        .send({ userId: id[who] })
        .expect(204);
    },
  };
}
