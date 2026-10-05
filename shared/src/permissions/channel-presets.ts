/**
 * Channel permission presets: the overwrite sets the channel settings UI
 * writes, and the reverse mapping that recognises them. Shared so the
 * backend e2e can apply exactly the payloads the UI builds, and so the two
 * never disagree on the server's rules (anti-escalation + role hierarchy,
 * see backend channel-permissions.service.ts).
 *
 * Positions follow the backend: a LOWER position is a HIGHER rank.
 */

export type PresetId = 'NORMAL' | 'READ_ONLY' | 'ANNOUNCEMENT';
export type StoredPresetId = PresetId | 'MODS_ONLY' | 'CUSTOM';

export interface PresetRole {
  id: string;
  name: string;
  position: number;
  actions: readonly string[];
}

export interface PresetOverwrite {
  targetType: 'EVERYONE' | 'ROLE';
  roleId: string | null;
  allow: string[];
  deny: string[];
}

/** What a preset takes from @everyone (and gives back to its post roles). */
export const PRESET_DENIES: Readonly<Record<PresetId, readonly string[]>> = {
  NORMAL: [],
  // Read-only: nobody but the post roles posts, attaches or reacts
  READ_ONLY: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'],
  // Announcement: like read-only, but everyone can still react
  ANNOUNCEMENT: ['CREATE_MESSAGE', 'ATTACH_FILES'],
};

export interface BuildPresetInput {
  preset: PresetId;
  /** Roles that may post in a read-only/announcement channel. */
  postRoleIds: readonly string[];
  /** NORMAL only: false adds an @everyone deny of ATTACH_FILES. */
  membersCanAttach: boolean;
  /** Every role of the community. */
  roles: readonly PresetRole[];
  /**
   * The actor's highest rank (lowest position), or null for the instance
   * owner. Roles ranked above it, or at it, that hold a denied action get an
   * explicit allow: the server requires it for roles above (an @everyone
   * deny may not strip them), and it keeps the actor's own role posting.
   */
  actorBestPosition: number | null;
}

export interface BuiltPreset {
  /** The payload for PUT /channels/:id/overwrites. */
  preset: PresetId;
  overwrites: PresetOverwrite[];
  /** Roles at or above the actor's rank that got an allow automatically. */
  autoAllowedRoleIds: string[];
}

export function presetDenies(preset: PresetId, membersCanAttach: boolean): string[] {
  if (preset === 'NORMAL') return membersCanAttach ? [] : ['ATTACH_FILES'];
  return [...PRESET_DENIES[preset]];
}

export function buildPresetOverwrites(input: BuildPresetInput): BuiltPreset {
  const deny = presetDenies(input.preset, input.membersCanAttach);
  if (deny.length === 0) {
    return { preset: input.preset, overwrites: [], autoAllowedRoleIds: [] };
  }

  const allows = new Map<string, Set<string>>();
  const add = (roleId: string, actions: readonly string[]) => {
    const set = allows.get(roleId) ?? new Set<string>();
    actions.forEach((a) => set.add(a));
    allows.set(roleId, set);
  };

  if (input.preset !== 'NORMAL') {
    for (const roleId of input.postRoleIds) add(roleId, deny);
  }

  const autoAllowedRoleIds: string[] = [];
  if (input.actorBestPosition !== null) {
    for (const role of input.roles) {
      // Roles above the actor, and the actor's own rank (so applying a
      // preset never silences the actor's own role)
      if (role.position > input.actorBestPosition) continue;
      const kept = deny.filter((a) => role.actions.includes(a));
      if (kept.length === 0) continue;
      const already = allows.get(role.id);
      if (!already || kept.some((a) => !already.has(a))) {
        autoAllowedRoleIds.push(role.id);
      }
      add(role.id, kept);
    }
  }

  // Deterministic order: by rank, then id
  const rank = new Map(input.roles.map((r) => [r.id, r.position]));
  const roleIds = [...allows.keys()].sort(
    (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || a.localeCompare(b),
  );

  return {
    preset: input.preset,
    overwrites: [
      { targetType: 'EVERYONE', roleId: null, allow: [], deny },
      ...roleIds.map((roleId) => ({
        targetType: 'ROLE' as const,
        roleId,
        allow: deny.filter((a) => allows.get(roleId)!.has(a)),
        deny: [],
      })),
    ],
    autoAllowedRoleIds,
  };
}

export interface DetectedPreset {
  preset: PresetId | 'CUSTOM';
  /** Roles that may post (an allow of the preset's full deny set). */
  postRoleIds: string[];
  membersCanAttach: boolean;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Which preset a stored overwrite set is, or CUSTOM. Role allows that are a
 * strict subset of the preset's denies are the automatic "keep it for roles
 * above" allows, not post roles.
 */
export function detectPreset(
  overwrites: readonly {
    targetType: string;
    roleId: string | null;
    allow: readonly string[];
    deny: readonly string[];
  }[],
): DetectedPreset {
  const custom: DetectedPreset = {
    preset: 'CUSTOM',
    postRoleIds: [],
    membersCanAttach: true,
  };
  if (overwrites.length === 0) {
    return { preset: 'NORMAL', postRoleIds: [], membersCanAttach: true };
  }
  if (overwrites.some((o) => o.targetType !== 'EVERYONE' && o.targetType !== 'ROLE')) {
    return custom;
  }
  const everyone = overwrites.filter((o) => o.targetType === 'EVERYONE');
  const roles = overwrites.filter((o) => o.targetType === 'ROLE');
  if (everyone.length !== 1 || everyone[0].allow.length > 0) return custom;
  if (roles.some((o) => o.deny.length > 0 || o.roleId === null)) return custom;
  const deny = everyone[0].deny;

  if (sameSet(deny, ['ATTACH_FILES'])) {
    // NORMAL without attachments: only automatic allows may accompany it
    return roles.every((o) => o.allow.every((a) => a === 'ATTACH_FILES'))
      ? { preset: 'NORMAL', postRoleIds: [], membersCanAttach: false }
      : custom;
  }
  for (const preset of ['READ_ONLY', 'ANNOUNCEMENT'] as const) {
    const full = PRESET_DENIES[preset];
    if (!sameSet(deny, full)) continue;
    if (!roles.every((o) => o.allow.length > 0 && o.allow.every((a) => full.includes(a)))) {
      return custom;
    }
    return {
      preset,
      postRoleIds: roles.filter((o) => sameSet(o.allow, full)).map((o) => o.roleId!),
      membersCanAttach: false,
    };
  }
  return custom;
}
