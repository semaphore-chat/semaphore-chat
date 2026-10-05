/**
 * Props for the RoleEditor stories (`stories/components/RoleEditor.stories.tsx`).
 * Plain `.ts`: exports data and functions only.
 */
import type { RoleDto } from '../../api-client/types.gen';
import { PERMISSION_GROUPS } from '../../constants/rbacActions';
import { MEMBER_ACTIONS, makeRole } from './edge/voice';

type Action = RoleDto['actions'][number];

/** Every action the role editor shows (all groups). */
export const ALL_EDITOR_ACTIONS = Object.values(PERMISSION_GROUPS).flat() as Action[];

export interface RoleEditorFixture {
  communityId: string;
  /** No preset: creating a new role. */
  preset?: 'member' | 'all';
  name?: string;
}

export function roleEditorProps({ communityId, preset, name }: RoleEditorFixture) {
  const role = preset
    ? makeRole(
        communityId,
        name ?? (preset === 'all' ? 'Everything' : 'Member'),
        preset === 'all' ? ALL_EDITOR_ACTIONS : MEMBER_ACTIONS,
        preset === 'all' ? 5 : 100,
      )
    : undefined;
  return {
    role,
    onSave: async () => {},
    onCancel: () => {},
  };
}
