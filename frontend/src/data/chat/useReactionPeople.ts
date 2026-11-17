/**
 * Who reacted with one emoji, as the reader is told: the first `REACTION_PEOPLE_SHOWN` people by name (a display
 * name, else the username, else "User " and the id's last four characters, as the old tooltip), and how many more.
 * A name still loading is `null`. Both shells use it: the old chip's tooltip and the new shell's reactions sheet.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { userControllerGetUserByIdOptions } from '../../api-client/@tanstack/react-query.gen';

/** How many people are named; the rest are counted (as the old tooltip). */
export const REACTION_PEOPLE_SHOWN = 15;

export interface ReactionPerson {
  id: string;
  /** `null` while the person is loading. */
  name: string | null;
}

export interface ReactionPeople {
  people: ReactionPerson[];
  /** How many reacted beyond the named ones. */
  more: number;
}

/** The name a reaction list shows for a person whose account has no name (or could not be loaded). */
export function unnamedReactor(userId: string): string {
  return `User ${userId.slice(-4)}`;
}

export function useReactionPeople(userIds: readonly string[] | null | undefined): ReactionPeople {
  const shown = useMemo(() => (userIds ?? []).slice(0, REACTION_PEOPLE_SHOWN), [userIds]);
  const results = useQueries({
    queries: shown.map((id) => userControllerGetUserByIdOptions({ path: { id } })),
  });
  return {
    people: shown.map((id, i) => {
      const { data, isLoading } = results[i];
      return { id, name: isLoading ? null : data?.displayName || data?.username || unnamedReactor(id) };
    }),
    more: Math.max(0, (userIds?.length ?? 0) - shown.length),
  };
}
