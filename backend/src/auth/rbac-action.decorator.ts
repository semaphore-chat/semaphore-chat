import { SetMetadata } from '@nestjs/common';
import { RbacActions } from '@prisma/client';

export const RBAC_ACTION_KEY = 'rbac-action';
export const RequiredActions = (...actions: RbacActions[]) =>
  SetMetadata(RBAC_ACTION_KEY, actions);

export const RBAC_ANY_ACTION_KEY = 'rbac-any-action';
/**
 * Any one of these actions is enough (RequiredActions needs all of them). Use
 * it where either action opens the same thing, e.g. the timeout list, which a
 * ban-list viewer and a timeout moderator may both see (#688). An endpoint uses
 * one decorator or the other.
 */
export const RequiredAnyActions = (...actions: RbacActions[]) =>
  SetMetadata(RBAC_ANY_ACTION_KEY, actions);
