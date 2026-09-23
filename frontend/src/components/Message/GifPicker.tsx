import React, { useState } from "react";
import {
  Box,
  Popover,
  TextField,
  InputAdornment,
  IconButton,
  CircularProgress,
  Typography,
} from "@mui/material";
import { Search as SearchIcon, Clear as ClearIcon } from "@mui/icons-material";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useResponsive } from "../../hooks/useResponsive";
import { useDebounce } from "../../hooks/useDebounce";
import { MobileSheet } from "../Mobile/common/MobileSheet";
import {
  gifsControllerSearch,
  gifsControllerFeatured,
} from "../../api-client/sdk.gen";
import type { GifResultDto } from "../../api-client/types.gen";

const GIF_PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;
/** Start loading the next page once the user scrolls within this many px of the bottom. */
const SCROLL_LOAD_THRESHOLD_PX = 80;

/**
 * Shared search field + infinite-scrolling GIF grid, used by GifPickerPopover.
 * Shows Tenor's featured/trending GIFs when the search box is empty.
 */
const GifPickerContent: React.FC<{
  onGifClick: (gif: GifResultDto) => void;
  /** Touch variant: full-width, taller (for MobileSheet). */
  touch?: boolean;
}> = ({ onGifClick, touch = false }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery.trim(), SEARCH_DEBOUNCE_MS);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: debouncedQuery
        ? (["gifs", "search", debouncedQuery] as const)
        : (["gifs", "featured"] as const),
      queryFn: async ({ pageParam, signal }) => {
        if (debouncedQuery) {
          const { data } = await gifsControllerSearch({
            query: {
              q: debouncedQuery,
              limit: GIF_PAGE_LIMIT,
              pos: pageParam || undefined,
            },
            throwOnError: true,
            signal,
          });
          return data;
        }
        const { data } = await gifsControllerFeatured({
          query: { limit: GIF_PAGE_LIMIT, pos: pageParam || undefined },
          throwOnError: true,
          signal,
        });
        return data;
      },
      initialPageParam: "",
      getNextPageParam: (lastPage) => lastPage.next || undefined,
    });

  const gifs = data?.pages.flatMap((page) => page.results) ?? [];

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <
      SCROLL_LOAD_THRESHOLD_PX;
    if (nearBottom && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <Box
      sx={{
        width: touch ? "100%" : "320px",
        height: touch ? "60vh" : "420px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header with Search */}
      <Box
        sx={{
          p: 1.5,
          pb: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <TextField
          size="small"
          placeholder="Search GIFs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
          fullWidth
          sx={{
            "& .MuiOutlinedInput-root": {
              fontSize: 'scale.base',
              borderRadius: "8px",
              backgroundColor: "action.hover",
              "& fieldset": {
                border: "none",
              },
              "&:hover fieldset": {
                border: "none",
              },
              "&.Mui-focused fieldset": {
                border: "1px solid",
                borderColor: "primary.main",
              },
            },
            "& .MuiOutlinedInput-input": {
              padding: "8px 12px",
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 'icon.md', color: "text.disabled" }} />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setSearchQuery("")}
                  sx={{ p: 0.5 }}
                >
                  <ClearIcon sx={{ fontSize: 'icon.sm' }} />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Scrollable GIF grid */}
      <Box
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          p: 1,
          "&::-webkit-scrollbar": {
            width: "6px",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: "rgba(255, 255, 255, 0.2)",
            borderRadius: "3px",
            "&:hover": {
              backgroundColor: "rgba(255, 255, 255, 0.3)",
            },
          },
        }}
      >
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : gifs.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              py: 4,
              color: "text.disabled",
            }}
          >
            <Typography variant="body2">No GIFs found</Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "4px",
            }}
          >
            {gifs.map((gif) => (
              <Box
                key={gif.id}
                component="button"
                type="button"
                onClick={() => onGifClick(gif)}
                aria-label={gif.title || "GIF"}
                sx={{
                  border: "none",
                  borderRadius: "6px",
                  overflow: "hidden",
                  cursor: "pointer",
                  p: 0,
                  backgroundColor: "action.hover",
                  aspectRatio: `${gif.width || 1} / ${gif.height || 1}`,
                  transition: "opacity 0.12s ease",
                  "&:hover": {
                    opacity: 0.85,
                  },
                }}
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title || ""}
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </Box>
            ))}
          </Box>
        )}
        {isFetchingNextPage && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
            <CircularProgress size={20} />
          </Box>
        )}
      </Box>

      {/* Attribution required by Giphy's API terms */}
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          borderTop: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary" align="right" display="block">
          Powered by GIPHY
        </Typography>
      </Box>
    </Box>
  );
};

export interface GifPickerPopoverProps {
  open: boolean;
  /** Element anchor (used by the composer GIF button); opens above the anchor. */
  anchorEl?: HTMLElement | null;
  onClose: () => void;
  onSelect: (gif: GifResultDto) => void;
  /** Sheet title on touch devices. */
  title?: string;
}

/**
 * Controlled GIF picker popover. Mirrors EmojiPickerPopover's structure:
 * anchors to an element and opens above it on desktop, renders as a
 * full-width bottom sheet on touch devices.
 */
export const GifPickerPopover: React.FC<GifPickerPopoverProps> = ({
  open,
  anchorEl,
  onClose,
  onSelect,
  title = "GIFs",
}) => {
  const { shouldUseTouchUI } = useResponsive();

  if (shouldUseTouchUI) {
    return (
      <MobileSheet open={open} onClose={onClose} title={title} maxHeight="70vh">
        <GifPickerContent onGifClick={onSelect} touch />
      </MobileSheet>
    );
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      // Without this, the Modal's focus trap re-focuses the GIF BUTTON when
      // the exit transition finishes — clobbering the composer's focus.
      disableRestoreFocus
      anchorOrigin={{
        vertical: "top",
        horizontal: "left",
      }}
      transformOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
    >
      <GifPickerContent onGifClick={onSelect} />
    </Popover>
  );
};
