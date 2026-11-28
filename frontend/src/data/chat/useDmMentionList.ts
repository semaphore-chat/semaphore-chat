/**
 * The `@` list of a DM composer, shared by both shells: a DM has no server-backed list (`useMentionAutocomplete`
 * reads a community), so the group's members are filtered locally by the query at the caret.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getCurrentMention, type UserMention } from '../../utils/mentionParser';
import type { SimpleMentionState } from './useComposerKeys';

const CLOSED: SimpleMentionState = { isOpen: false, suggestions: [], selectedIndex: 0, query: '', type: null, isLoading: false };

export interface UseDmMentionListOptions {
  /** Off (a channel composer): the list stays closed. */
  enabled: boolean;
  text: string;
  cursorPosition: number;
  /** Who can be mentioned: the DM group's members. */
  userMentions: UserMention[];
}

export function useDmMentionList({ enabled, text, cursorPosition, userMentions }: UseDmMentionListOptions): {
  state: SimpleMentionState;
  setState: Dispatch<SetStateAction<SimpleMentionState>>;
  close: () => void;
} {
  const [state, setState] = useState<SimpleMentionState>(CLOSED);
  const close = useCallback(() => setState((prev) => ({ ...prev, isOpen: false })), []);

  useEffect(() => {
    if (!enabled) return;

    const currentMention = getCurrentMention(text, cursorPosition);
    if (currentMention && currentMention.query) {
      const filteredUsers = userMentions.filter((user) =>
        (user.displayName || user.username).toLowerCase().includes(currentMention.query.toLowerCase()),
      );

      setState((prev) => {
        const newSuggestions = filteredUsers.map((user) => ({
          id: user.id,
          type: 'user' as const,
          displayName: user.displayName || user.username,
          subtitle: user.username !== user.displayName ? `@${user.username}` : undefined,
          username: user.username,
        }));

        const shouldOpen = filteredUsers.length > 0;
        if (
          prev.isOpen === shouldOpen &&
          prev.query === currentMention.query &&
          JSON.stringify(prev.suggestions) === JSON.stringify(newSuggestions)
        ) {
          return prev;
        }

        return {
          isOpen: shouldOpen,
          suggestions: newSuggestions,
          selectedIndex: 0,
          query: currentMention.query,
          type: 'user' as const,
          isLoading: false,
        };
      });
    } else {
      setState((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
    }
  }, [text, cursorPosition, userMentions, enabled]);

  return { state, setState, close };
}
