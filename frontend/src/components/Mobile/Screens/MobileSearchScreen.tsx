/**
 * MobileSearchScreen
 *
 * Full-screen message search for phones (and the tablet content pane), at
 * `/community/:communityId/channel/:channelId/search`. Desktop keeps the
 * anchored `MessageSearch` popover; both share `useMessageSearch` and
 * `MessageSearchResultList`.
 *
 * The query lives in `?q=` (updated with `replace`), so going back from a
 * result to this screen restores the search. Tapping a result pushes the chat
 * with `?highlight=<messageId>`, which the chat scrolls to and highlights.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AppBar,
  Box,
  IconButton,
  InputBase,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
} from '@mui/material';
import { ArrowBack as BackIcon, Close as CloseIcon } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { channelsControllerFindOneOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useDebounce } from '../../../hooks/useDebounce';
import { LAYOUT_CONSTANTS, TOUCH_TARGETS } from '../../../utils/breakpoints';
import EmptyState from '../../Common/EmptyState';
import { SearchScope, useMessageSearch, type SearchResult } from '../../../hooks/useMessageSearch';
import { MessageSearchResultList } from '../../Message/MessageSearchResults';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';

interface MobileSearchScreenProps {
  communityId: string;
  channelId: string;
}

export const MobileSearchScreen: React.FC<MobileSearchScreenProps> = ({ communityId, channelId }) => {
  const { goBack } = useMobileNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [scope, setScope] = useState<SearchScope>(() =>
    searchParams.get('scope') === SearchScope.Community ? SearchScope.Community : SearchScope.Channel,
  );
  const debouncedQuery = useDebounce(query, 300);

  const { data: channel } = useQuery({
    ...channelsControllerFindOneOptions({ path: { id: channelId } }),
    enabled: !!channelId,
  });

  const { results, isLoading } = useMessageSearch({
    channelId,
    communityId,
    query: debouncedQuery,
    scope,
  });

  // Mirror the settled query + scope into the URL (replace, not push) so the
  // back stack stays chat → search → result.
  useEffect(() => {
    const q = debouncedQuery.trim();
    const currentQ = searchParams.get('q') ?? '';
    const currentScope = searchParams.get('scope') ?? SearchScope.Channel;
    if (q === currentQ && scope === currentScope) return;
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (scope !== SearchScope.Channel) next.set('scope', scope);
    setSearchParams(next, { replace: true });
  }, [debouncedQuery, scope, searchParams, setSearchParams]);

  // Autofocus once the slide-in has started (focusing inside a transform can
  // make mobile browsers skip opening the keyboard if done too early).
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const handleSelect = (result: SearchResult) => {
    if (!result.channelId) return;
    inputRef.current?.blur();
    navigate(`/community/${communityId}/channel/${result.channelId}?highlight=${result.id}`);
  };

  // Until the channel loads, name it generically rather than mislabel the scope.
  const placeholder =
    scope === SearchScope.Channel
      ? channel?.name
        ? `Search #${channel.name}`
        : 'Search this channel'
      : 'Search all channels';
  const isPending = isLoading || query.trim() !== debouncedQuery.trim();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          backgroundColor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          color: 'text.primary',
        }}
      >
        <Toolbar sx={{ minHeight: LAYOUT_CONSTANTS.APPBAR_HEIGHT_MOBILE, px: 1, gap: 0.5 }}>
          <IconButton
            edge="start"
            onClick={goBack}
            aria-label="Go back"
            sx={{ width: TOUCH_TARGETS.MINIMUM, height: TOUCH_TARGETS.MINIMUM }}
          >
            <BackIcon />
          </IconButton>
          <InputBase
            inputRef={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            inputProps={{
              'aria-label': 'Search messages',
              enterKeyHint: 'search',
              type: 'search',
              autoCapitalize: 'off',
              autoCorrect: 'off',
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              height: 40,
              px: 1.5,
              borderRadius: 2,
              bgcolor: 'action.hover',
              fontSize: 'scale.lg', // ≥16px so iOS doesn't zoom on focus
              '& input::-webkit-search-cancel-button': { display: 'none' },
            }}
          />
          {query && (
            <IconButton
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              sx={{ width: TOUCH_TARGETS.MINIMUM, height: TOUCH_TARGETS.MINIMUM }}
            >
              <CloseIcon />
            </IconButton>
          )}
        </Toolbar>
        <Box sx={{ px: 2, pb: 1 }}>
          <ToggleButtonGroup
            value={scope}
            exclusive
            onChange={(_, next: SearchScope | null) => next && setScope(next)}
            size="small"
            fullWidth
          >
            <ToggleButton value={SearchScope.Channel} sx={{ minHeight: TOUCH_TARGETS.MINIMUM, textTransform: 'none' }}>
              This Channel
            </ToggleButton>
            <ToggleButton value={SearchScope.Community} sx={{ minHeight: TOUCH_TARGETS.MINIMUM, textTransform: 'none' }}>
              All Channels
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pt: 1 }}>
        <MessageSearchResultList
          results={results}
          scope={scope}
          query={query.trim()}
          isLoading={isPending}
          onSelect={handleSelect}
          touch
          hintState={
            <EmptyState
              variant="search"
              title="Search messages"
              description={
                scope === SearchScope.Channel
                  ? channel?.name
                    ? `Find messages in #${channel.name}.`
                    : 'Find messages in this channel.'
                  : 'Find messages across every channel in this community.'
              }
            />
          }
          emptyState={
            <EmptyState
              variant="search"
              title="No messages found"
              description={`Nothing matches “${query.trim()}”. Try other words${
                scope === SearchScope.Channel ? ' or search all channels' : ''
              }.`}
              action={
                scope === SearchScope.Channel
                  ? { label: 'Search all channels', onClick: () => setScope(SearchScope.Community) }
                  : undefined
              }
            />
          }
        />
      </Box>
    </Box>
  );
};

export default MobileSearchScreen;
