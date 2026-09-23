/**
 * Search result list shared by the desktop `MessageSearch` popover and the
 * phone `MobileSearchScreen` (author, channel chip in community scope,
 * relative time, 2-line preview). The query itself is `useMessageSearch`.
 */
import React from "react";
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  CircularProgress,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { userControllerGetUserByIdOptions } from "../../api-client/@tanstack/react-query.gen";
import { SearchScope, type SearchResult } from "../../hooks/useMessageSearch";
import { TOUCH_TARGETS } from "../../utils/breakpoints";

function getMessagePreview(result: SearchResult, maxLength = 100): string {
  const text = result.spans
    .filter((span) => span.text)
    .map((span) => span.text)
    .join(" ");
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
}

const ResultAuthor: React.FC<{ authorId: string }> = ({ authorId }) => {
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: authorId } }),
    staleTime: 5 * 60 * 1000,
  });
  if (!author) return null;
  return (
    <Typography
      component="span"
      variant="caption"
      noWrap
      sx={{ fontWeight: 600, color: "text.primary", minWidth: 0, flexShrink: 1 }}
    >
      {author.displayName || author.username}
    </Typography>
  );
};

interface MessageSearchResultListProps {
  results: SearchResult[];
  scope: SearchScope;
  /** Current (raw) query text — decides between the hint and "no results". */
  query: string;
  isLoading: boolean;
  onSelect: (result: SearchResult) => void;
  /** Keyboard-highlighted row (desktop). */
  selectedIndex?: number;
  /** Touch-sized rows (full-width screen on phones). */
  touch?: boolean;
  /** Replaces the default "No messages found" line. */
  emptyState?: React.ReactNode;
  /** Replaces the default "Type to search messages" line. */
  hintState?: React.ReactNode;
}

export const MessageSearchResultList: React.FC<MessageSearchResultListProps> = ({
  results,
  scope,
  query,
  isLoading,
  onSelect,
  selectedIndex,
  touch = false,
  emptyState,
  hintState,
}) => {
  if (!query) {
    return (
      <>
        {hintState ?? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
            Type to search messages
          </Typography>
        )}
      </>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={24} aria-label="Searching" />
      </Box>
    );
  }

  if (results.length === 0) {
    return (
      <>
        {emptyState ?? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
            No messages found
          </Typography>
        )}
      </>
    );
  }

  return (
    <List disablePadding aria-label="Search results">
      {results.map((result, index) => (
        <ListItemButton
          key={result.id}
          selected={index === selectedIndex}
          onClick={() => onSelect(result)}
          sx={{
            borderRadius: 1,
            mb: 0.5,
            ...(touch && { minHeight: TOUCH_TARGETS.COMFORTABLE, py: 1.25 }),
            "&.Mui-selected": {
              backgroundColor: "action.selected",
            },
          }}
        >
          <ListItemText
            disableTypography
            primary={
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 0.5,
                  minWidth: 0,
                }}
              >
                {result.authorId && <ResultAuthor authorId={result.authorId} />}
                {scope === SearchScope.Community && result.channelName && (
                  <Typography
                    component="span"
                    variant="caption"
                    noWrap
                    sx={{
                      backgroundColor: "action.hover",
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 0.5,
                      flexShrink: 0,
                      maxWidth: "40%",
                    }}
                  >
                    #{result.channelName}
                  </Typography>
                )}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flexShrink: 0 }}
                >
                  {formatDistanceToNow(new Date(result.sentAt), {
                    addSuffix: true,
                  })}
                </Typography>
              </Box>
            }
            secondary={
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  wordBreak: "break-word",
                }}
              >
                {getMessagePreview(result)}
              </Typography>
            }
          />
        </ListItemButton>
      ))}
    </List>
  );
};
