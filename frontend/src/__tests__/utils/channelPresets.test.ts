import { describe, it, expect } from 'vitest';
import {
  buildPresetOverwrites,
  detectPreset,
  type PresetId,
  type PresetRole,
} from '@semaphore-chat/shared';

const ADMIN: PresetRole = {
  id: 'admin',
  name: 'Community Admin',
  position: 10,
  actions: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION', 'MANAGE_CHANNEL_PERMISSIONS'],
};
const MOD: PresetRole = {
  id: 'mod',
  name: 'Moderator',
  position: 20,
  actions: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION', 'MANAGE_CHANNEL_PERMISSIONS'],
};
const POSTER: PresetRole = {
  id: 'poster',
  name: 'Poster',
  position: 40,
  actions: ['CREATE_MESSAGE'],
};
const MEMBER: PresetRole = {
  id: 'member',
  name: 'Member',
  position: 100,
  actions: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'],
};
const ROLES = [ADMIN, MOD, POSTER, MEMBER];

describe('buildPresetOverwrites', () => {
  it('NORMAL writes nothing', () => {
    expect(
      buildPresetOverwrites({
        preset: 'NORMAL',
        postRoleIds: [],
        membersCanAttach: true,
        roles: ROLES,
        actorBestPosition: null,
      }).overwrites,
    ).toEqual([]);
  });

  it('NORMAL without attachments: @everyone deny ATTACH_FILES', () => {
    expect(
      buildPresetOverwrites({
        preset: 'NORMAL',
        postRoleIds: [],
        membersCanAttach: false,
        roles: ROLES,
        actorBestPosition: null,
      }).overwrites,
    ).toEqual([{ targetType: 'EVERYONE', roleId: null, allow: [], deny: ['ATTACH_FILES'] }]);
  });

  it('READ_ONLY denies posting, files and reactions; post roles get them back', () => {
    const { overwrites, autoAllowedRoleIds } = buildPresetOverwrites({
      preset: 'READ_ONLY',
      postRoleIds: ['poster'],
      membersCanAttach: true,
      roles: ROLES,
      actorBestPosition: null, // owner: no automatic allows
    });
    expect(overwrites).toEqual([
      {
        targetType: 'EVERYONE',
        roleId: null,
        allow: [],
        deny: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'],
      },
      {
        targetType: 'ROLE',
        roleId: 'poster',
        allow: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'],
        deny: [],
      },
    ]);
    expect(autoAllowedRoleIds).toEqual([]);
  });

  it('ANNOUNCEMENT keeps reactions for everyone', () => {
    const { overwrites } = buildPresetOverwrites({
      preset: 'ANNOUNCEMENT',
      postRoleIds: [],
      membersCanAttach: true,
      roles: ROLES,
      actorBestPosition: null,
    });
    expect(overwrites[0].deny).toEqual(['CREATE_MESSAGE', 'ATTACH_FILES']);
  });

  it('a Moderator keeps roles above them: Community Admin gets an automatic allow', () => {
    const { overwrites, autoAllowedRoleIds } = buildPresetOverwrites({
      preset: 'ANNOUNCEMENT',
      postRoleIds: ['mod'],
      membersCanAttach: true,
      roles: ROLES,
      actorBestPosition: MOD.position,
    });
    expect(autoAllowedRoleIds).toEqual(['admin']);
    expect(overwrites.map((o) => o.roleId)).toEqual([null, 'admin', 'mod']);
    expect(overwrites[1]).toEqual({
      targetType: 'ROLE',
      roleId: 'admin',
      allow: ['CREATE_MESSAGE', 'ATTACH_FILES'],
      deny: [],
    });
  });

  it('automatic allows only cover actions the higher role actually holds', () => {
    const { overwrites } = buildPresetOverwrites({
      preset: 'READ_ONLY',
      postRoleIds: [],
      membersCanAttach: true,
      roles: ROLES,
      actorBestPosition: 60, // below Poster, which holds only CREATE_MESSAGE
    });
    expect(overwrites.find((o) => o.roleId === 'poster')?.allow).toEqual(['CREATE_MESSAGE']);
    expect(overwrites.find((o) => o.roleId === 'member')).toBeUndefined();
  });

  it("a chosen post role isn't reported as automatic; the actor's own rank is", () => {
    const { autoAllowedRoleIds, overwrites } = buildPresetOverwrites({
      preset: 'ANNOUNCEMENT',
      postRoleIds: ['admin'],
      membersCanAttach: true,
      roles: ROLES,
      actorBestPosition: MOD.position,
    });
    // Applying a preset never silences the actor's own role
    expect(autoAllowedRoleIds).toEqual(['mod']);
    expect(overwrites.find((o) => o.roleId === 'mod')?.allow).toEqual([
      'CREATE_MESSAGE',
      'ATTACH_FILES',
    ]);
  });
});

describe('detectPreset', () => {
  it.each<[PresetId, string[], boolean, number | null]>([
    ['NORMAL', [], true, null],
    ['NORMAL', [], false, null],
    ['READ_ONLY', ['poster'], true, null],
    ['READ_ONLY', ['mod'], true, MOD.position],
    ['ANNOUNCEMENT', ['mod', 'poster'], true, MOD.position],
    ['ANNOUNCEMENT', [], true, 60],
  ])('round-trips %s (posters %j, attach %s, actor %s)', (preset, postRoleIds, membersCanAttach, actor) => {
    const built = buildPresetOverwrites({
      preset,
      postRoleIds,
      membersCanAttach,
      roles: ROLES,
      actorBestPosition: actor,
    });
    const detected = detectPreset(built.overwrites);
    expect(detected.preset).toBe(preset);
    // Automatic allows that equal the full set read back as posters
    const expectedPosters = new Set([
      ...postRoleIds,
      ...built.autoAllowedRoleIds.filter((id) => {
        const allow = built.overwrites.find((o) => o.roleId === id)?.allow ?? [];
        return allow.length === built.overwrites[0]?.deny.length;
      }),
    ]);
    expect(new Set(detected.postRoleIds)).toEqual(expectedPosters);
    if (preset === 'NORMAL') expect(detected.membersCanAttach).toBe(membersCanAttach);
  });

  it.each([
    ['a role deny', [{ targetType: 'ROLE', roleId: 'x', allow: [], deny: ['CREATE_MESSAGE'] }]],
    ['an @everyone allow', [{ targetType: 'EVERYONE', roleId: null, allow: ['CREATE_MESSAGE'], deny: [] }]],
    ['an unknown deny set', [{ targetType: 'EVERYONE', roleId: null, allow: [], deny: ['VIDEO'] }]],
    ['a member overwrite', [{ targetType: 'MEMBER', roleId: null, allow: [], deny: ['VIDEO'] }]],
    [
      'a role allow outside the preset',
      [
        { targetType: 'EVERYONE', roleId: null, allow: [], deny: ['CREATE_MESSAGE', 'ATTACH_FILES'] },
        { targetType: 'ROLE', roleId: 'x', allow: ['VIDEO'], deny: [] },
      ],
    ],
  ])('anything else is CUSTOM: %s', (_name, overwrites) => {
    expect(detectPreset(overwrites).preset).toBe('CUSTOM');
  });
});
