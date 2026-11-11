import { describe, expect, it } from 'vitest';
import {
  RBAC_ACTIONS,
  PERMISSION_GROUPS,
  ACTION_LABELS,
} from '../../constants/rbacActions';

/**
 * Instance-wide actions the community role editor deliberately leaves out.
 * Everything else in RBAC_ACTIONS is community-scoped and must be grantable
 * from a permission group.
 */
const INSTANCE_LEVEL_ACTIONS = new Set<string>([
  RBAC_ACTIONS.CREATE_COMMUNITY,
  RBAC_ACTIONS.READ_INSTANCE_SETTINGS,
  RBAC_ACTIONS.UPDATE_INSTANCE_SETTINGS,
  RBAC_ACTIONS.READ_INSTANCE_STATS,
  RBAC_ACTIONS.MANAGE_USER_STORAGE,
]);

describe('permission groups', () => {
  it('includes every community-level action in a group', () => {
    // Same source the role editor renders from
    const grouped = new Set<string>(Object.values(PERMISSION_GROUPS).flat());
    const missing = Object.values(RBAC_ACTIONS).filter(
      (action) => !grouped.has(action) && !INSTANCE_LEVEL_ACTIONS.has(action),
    );

    expect(missing).toEqual([]);
  });

  it('groups CAPTURE_REPLAY under Voice', () => {
    expect(PERMISSION_GROUPS['Voice']).toContain(RBAC_ACTIONS.CAPTURE_REPLAY);
  });

  it('has a human-readable label for CAPTURE_REPLAY', () => {
    expect(ACTION_LABELS[RBAC_ACTIONS.CAPTURE_REPLAY]).toBe(
      'Capture voice replays',
    );
  });
});
