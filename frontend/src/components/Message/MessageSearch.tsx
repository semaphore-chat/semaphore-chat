import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Box,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  InputAdornment,
  IconButton,
  Popover,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { useNavigate } from "react-router-dom";
import { useDebounce } from "../../hooks/useDebounce";
import { SearchScope, useMessageSearch, type SearchResult } from "../../hooks/useMessageSearch";
import { MessageSearchResultList } from "./MessageSearchResults";

interface MessageSearchBodyProps {
  channelId: string;
  communityId: string;
  /** Focus the input when this turns true (popover open, panel shown). */
  active: boolean;
  onClose: () => void;
  /**
   * Called after a result was opened. The popover closes; the docked side
   * panel stays open so you can step through several results.
   */
  onResultOpened?: () => void;
  /** Fill the parent's height (docked panel) instead of a 350px result box. */
  fillHeight?: boolean;
}

/**
 * The search input, scope toggle and results: shared by the desktop popover
 * (narrow windows) and the docked side panel (wide desktop).
 */
export const MessageSearchBody: React.FC<MessageSearchBodyProps> = ({
  channelId,
  communityId,
  active,
  onClose,
  onResultOpened,
  fillHeight = false,
}) => {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>(SearchScope.Channel);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const debouncedQuery = useDebounce(query, 300);
  const { results, isLoading, isError, refetch } = useMessageSearch({
    channelId,
    communityId,
    query: debouncedQuery,
    scope,
  });

  // Keyboard selection resets to the first row whenever the search changes.
  const searchKey = `${scope}:${debouncedQuery}`;
  const [selection, setSelection] = useState({ key: searchKey, index: 0 });
  const selectedIndex = selection.key === searchKey ? selection.index : 0;
  const setSelectedIndex = (update: (prev: number) => number) =>
    setSelection({ key: searchKey, index: update(selectedIndex) });

  // Focus the input when the popover / panel opens
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [active]);

  const handleScopeChange = useCallback(
    (_: React.MouseEvent<HTMLElement>, newScope: SearchScope | null) => {
      if (newScope) {
        setScope(newScope);
      }
    },
    []
  );

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      // Navigate to the channel/message with highlight param
      const targetChannelId = result.channelId;
      if (targetChannelId) {
        navigate(
          `/community/${communityId}/channel/${targetChannelId}?highlight=${result.id}`
        );
      }
      onResultOpened?.();
    },
    [communityId, navigate, onResultOpened]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIndex]) {
          handleResultClick(results[selectedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <Box
      sx={{
        p: 2,
        ...(fillHeight && { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }),
      }}
    >
      {/* Search Input */}
      <TextField
        fullWidth
        size="small"
        placeholder="Search messages..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: query && (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setQuery("")}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        sx={{ mb: 1 }}
      />

      {/* Scope Toggle */}
      <ToggleButtonGroup
        value={scope}
        exclusive
        onChange={handleScopeChange}
        size="small"
        fullWidth
        sx={{ mb: 2 }}
      >
        <ToggleButton value={SearchScope.Channel}>This Channel</ToggleButton>
        <ToggleButton value={SearchScope.Community}>All Channels</ToggleButton>
      </ToggleButtonGroup>

      {/* Results */}
      <Box sx={fillHeight ? { flex: 1, minHeight: 0, overflow: "auto", mx: -2, px: 2 } : { maxHeight: 350, overflow: "auto" }}>
        <MessageSearchResultList
          results={results}
          scope={scope}
          query={query}
          // Spinner (not "No messages found") while the debounce is pending.
          isLoading={isLoading || query.trim() !== debouncedQuery.trim()}
          isError={isError}
          onRetry={() => void refetch()}
          onSelect={handleResultClick}
          selectedIndex={selectedIndex}
        />
      </Box>
    </Box>
  );
};

interface MessageSearchProps {
  channelId: string;
  communityId: string;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

/** Search in a popover under the header's search button. */
const MessageSearch: React.FC<MessageSearchProps> = ({
  channelId,
  communityId,
  anchorEl,
  onClose,
}) => {
  const isOpen = Boolean(anchorEl);
  return (
    <Popover
      open={isOpen}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "right",
      }}
      transformOrigin={{
        vertical: "top",
        horizontal: "right",
      }}
      slotProps={{
        paper: {
          sx: {
            width: 400,
            maxHeight: 500,
            mt: 1,
          },
        },
      }}
    >
      <MessageSearchBody
        channelId={channelId}
        communityId={communityId}
        active={isOpen}
        onClose={onClose}
        onResultOpened={onClose}
      />
    </Popover>
  );
};

export default MessageSearch;
