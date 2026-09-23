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

interface MessageSearchProps {
  channelId: string;
  communityId: string;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const MessageSearch: React.FC<MessageSearchProps> = ({
  channelId,
  communityId,
  anchorEl,
  onClose,
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

  const isOpen = Boolean(anchorEl);

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

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
      onClose();
    },
    [communityId, navigate, onClose]
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
      <Box sx={{ p: 2 }}>
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
        <Box sx={{ maxHeight: 350, overflow: "auto" }}>
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
    </Popover>
  );
};

export default MessageSearch;
