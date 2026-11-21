import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aliasGroupsControllerGetCommunityAliasGroupsOptions } from '../api-client/@tanstack/react-query.gen';
import { useAllCommunityMembers } from './useAllCommunityMembers';
import { getCurrentMention } from '../utils/mentionParser';

export interface MentionSuggestion {
  id: string;
  type: 'user' | 'special' | 'alias';
  displayName: string;
  subtitle?: string;
  avatar?: string;
  memberCount?: number;
}

export interface MentionAutocompleteState {
  isOpen: boolean;
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  query: string;
  type: 'user' | 'special' | 'channel' | 'alias' | null;
  isLoading: boolean;
}

interface UseMentionAutocompleteProps {
  communityId: string;
  text: string;
  cursorPosition: number;
  /** When a Set: user suggestions only include these user ids (a private channel's members). Null/undefined: no filter. */
  allowedUserIds?: ReadonlySet<string> | null;
  /** True while `allowedUserIds` is still loading (OR-ed into the state's isLoading). */
  allowedLoading?: boolean;
}

export function useMentionAutocomplete({
  communityId,
  text,
  cursorPosition,
  allowedUserIds,
  allowedLoading = false,
}: UseMentionAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Get current mention being typed
  const currentMention = useMemo(() => {
    return getCurrentMention(text, cursorPosition);
  }, [text, cursorPosition]);

  // Get all community members (cached, full paginated set) - only if we
  // have a valid communityId
  const {
    data: allMembers = [],
    isLoading: isLoadingMembers,
  } = useAllCommunityMembers(communityId, {
    enabled: !!communityId && communityId.trim() !== '',
  });

  // Get all alias groups for the community
  const {
    data: aliasGroups = [],
    isLoading: isLoadingAliasGroups,
  } = useQuery({
    ...aliasGroupsControllerGetCommunityAliasGroupsOptions({ path: { communityId } }),
    enabled: !!communityId && communityId.trim() !== '',
  });

  // Client-side filtering and processing
  const suggestions = useMemo((): MentionSuggestion[] => {
    if (!currentMention) return [];

    const query = currentMention.query.toLowerCase();
    const results: MentionSuggestion[] = [];

    // Always include special mentions when relevant
    const specialMentions = [
      { id: 'here', name: 'here', description: 'Notify online members in this channel' },
      { id: 'channel', name: 'channel', description: 'Notify all members in this channel' },
    ];
    
    // Add matching special mentions
    const matchingSpecials = specialMentions
      .filter(special => 
        query === '' || special.name.toLowerCase().includes(query)
      )
      .map(special => ({
        id: special.id,
        type: 'special' as const,
        displayName: special.name,
        subtitle: special.description,
      }));
    
    results.push(...matchingSpecials);

    // Add matching alias groups (mention groups)
    const aliasMatches = aliasGroups
      .filter(group =>
        query === '' || group.name.toLowerCase().includes(query)
      )
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();

        if (query === '') return aName.localeCompare(bName);

        // Priority: Exact match, then starts with, then alphabetical
        const aExact = aName === query;
        const bExact = bName === query;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = aName.startsWith(query);
        const bStarts = bName.startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return aName.localeCompare(bName);
      })
      .slice(0, 5) // Limit alias group results
      .map(group => ({
        id: group.id,
        type: 'alias' as const,
        displayName: group.name,
        subtitle: `${group.memberCount} member${group.memberCount !== 1 ? 's' : ''}`,
        memberCount: group.memberCount,
      }));

    results.push(...aliasMatches);

    // Add user mentions with smart filtering and ordering
    if (currentMention.type === 'user' || query !== '') {
      const userMatches = allMembers
        .filter(member => {
          if (!member.user) return false;
          if (allowedUserIds && !allowedUserIds.has(member.user.id)) return false;
          const username = member.user.username.toLowerCase();
          const displayName = (member.user.displayName || '').toLowerCase();
          
          return query === '' ||
                 username.includes(query) ||
                 displayName.includes(query);
        })
        .sort((a, b) => {
          const aUser = a.user!;
          const bUser = b.user!;
          const aUsername = aUser.username.toLowerCase();
          const bUsername = bUser.username.toLowerCase();
          const aDisplayName = (aUser.displayName || '').toLowerCase();
          const bDisplayName = (bUser.displayName || '').toLowerCase();
          
          if (query === '') return aUsername.localeCompare(bUsername);
          
          // Priority 1: Exact matches
          const aExactUsername = aUsername === query;
          const bExactUsername = bUsername === query;
          if (aExactUsername && !bExactUsername) return -1;
          if (!aExactUsername && bExactUsername) return 1;
          
          // Priority 2: Username starts with query
          const aUsernameStarts = aUsername.startsWith(query);
          const bUsernameStarts = bUsername.startsWith(query);
          if (aUsernameStarts && !bUsernameStarts) return -1;
          if (!aUsernameStarts && bUsernameStarts) return 1;
          
          // Priority 3: Display name starts with query
          const aDisplayStarts = aDisplayName.startsWith(query);
          const bDisplayStarts = bDisplayName.startsWith(query);
          if (aDisplayStarts && !bDisplayStarts) return -1;
          if (!aDisplayStarts && bDisplayStarts) return 1;
          
          // Priority 4: Alphabetical by username
          return aUsername.localeCompare(bUsername);
        })
        .slice(0, 8) // Limit to 8 user results for performance
        .map(member => ({
          id: member.user!.id,
          type: 'user' as const,
          displayName: member.user!.username,
          subtitle: member.user!.displayName || undefined,
          avatar: member.user!.avatarUrl || undefined,
        }));
      
      results.push(...userMatches);
    }

    return results.slice(0, 10); // Total limit of 10 results
  }, [currentMention, allMembers, aliasGroups, allowedUserIds]);

  // Update open state based on suggestions
  useEffect(() => {
    const shouldOpen = currentMention !== null && 
                      currentMention.query.length >= 0 &&
                      suggestions.length > 0;
    
    if (shouldOpen !== isOpen) {
      setIsOpen(shouldOpen);
      if (shouldOpen) {
        setSelectedIndex(0);
      }
    }
  }, [currentMention, suggestions.length, isOpen]);

  // Reset selected index when suggestions change
  useEffect(() => {
    if (suggestions.length > 0 && selectedIndex >= suggestions.length) {
      setSelectedIndex(0);
    }
  }, [suggestions.length, selectedIndex]);

  // Loading state - only show loading if we don't have any data cached yet
  const isLoading = useMemo(() => {
    if (!currentMention) return false;
    return (isLoadingMembers && allMembers.length === 0) ||
           (isLoadingAliasGroups && aliasGroups.length === 0) ||
           allowedLoading;
  }, [currentMention, isLoadingMembers, allMembers.length, isLoadingAliasGroups, aliasGroups.length, allowedLoading]);

  // Navigation functions
  const selectNext = useCallback(() => {
    if (suggestions.length === 0) return;
    setSelectedIndex(prev => (prev + 1) % suggestions.length);
  }, [suggestions.length]);

  const selectPrevious = useCallback(() => {
    if (suggestions.length === 0) return;
    setSelectedIndex(prev => prev === 0 ? suggestions.length - 1 : prev - 1);
  }, [suggestions.length]);

  const selectSuggestion = useCallback((index: number) => {
    if (index >= 0 && index < suggestions.length) {
      setSelectedIndex(index);
    }
  }, [suggestions.length]);

  const getSelectedSuggestion = useCallback(() => {
    return suggestions[selectedIndex] || null;
  }, [suggestions, selectedIndex]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSelectedIndex(0);
  }, []);

  // Keyboard event handler
  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (!isOpen || suggestions.length === 0) return false;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectNext();
        return true;

      case 'ArrowUp':
        event.preventDefault();
        selectPrevious();
        return true;

      case 'Enter':
      case 'Tab':
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          event.preventDefault();
          return true; // Let parent handle the actual insertion
        }
        return false;

      case 'Escape':
        event.preventDefault();
        close();
        return true;

      default:
        return false;
    }
  }, [isOpen, suggestions.length, selectedIndex, selectNext, selectPrevious, close]);

  const state: MentionAutocompleteState = {
    isOpen,
    suggestions,
    selectedIndex,
    query: currentMention?.query || '',
    type: currentMention?.type || null,
    isLoading,
  };

  return {
    state,
    currentMention,
    selectNext,
    selectPrevious,
    selectSuggestion,
    getSelectedSuggestion,
    close,
    handleKeyDown,
  };
}