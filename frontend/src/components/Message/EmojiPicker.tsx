import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { IconButton, Popover, Box, Typography, TextField, InputAdornment } from '@mui/material';
import { AddReaction as AddReactionIcon, Search as SearchIcon, Clear as ClearIcon } from '@mui/icons-material';
import { useResponsive } from '../../hooks/useResponsive';
import { MobileSheet } from '../Mobile/common/MobileSheet';
import { useCommunityCustomEmojis } from '../../hooks/useCommunityCustomEmojis';
import type { CustomEmojiDto } from '../../api-client/types.gen';
import { getFileUrl } from '../../utils/fileHelpers';
import {
  computeNextEmojiGridPosition,
  isEmojiGridNavKey,
  type EmojiGridPosition,
  type EmojiGridSection,
} from '../../utils/emojiGridNavigation';
import { EMOJI_CATEGORIES, EMOJI_NAMES } from './emojiData';

/** Section key for the "Custom" emoji group in the roving-tabindex grid. */
const CUSTOM_SECTION_KEY = '__custom__';

/**
 * Shared emoji grid content used by both EmojiPicker and EmojiPickerPopover.
 * Renders the search field and scrollable emoji grid.
 */
const EmojiPickerContent: React.FC<{
  onEmojiClick: (emoji: string) => void;
  /** Touch variant: full-width, taller, larger tap targets (for MobileSheet). */
  touch?: boolean;
  /** Community custom emojis to show in a "Custom" section (channels only). */
  customEmojis?: CustomEmojiDto[];
  /** Called when a custom emoji is picked. */
  onCustomEmojiClick?: (emoji: CustomEmojiDto) => void;
}> = ({ onEmojiClick, touch = false, customEmojis = [], onCustomEmojiClick }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCustomEmojis = useMemo(() => {
    if (!onCustomEmojiClick || customEmojis.length === 0) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) return customEmojis;
    return customEmojis.filter((e) => e.name.toLowerCase().includes(query));
  }, [customEmojis, onCustomEmojiClick, searchQuery]);

  // Filter emojis based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return EMOJI_CATEGORIES;
    }

    const query = searchQuery.toLowerCase().trim();
    const results: Record<string, string[]> = {};

    // Search through all categories
    Object.entries(EMOJI_CATEGORIES).forEach(([category, emojis]) => {
      const matchedEmojis = emojis.filter((emoji) => {
        // Check if emoji itself contains the query (for searching by emoji)
        if (emoji.includes(query)) return true;

        // Check if any of the emoji's names match the query
        const names = EMOJI_NAMES[emoji];
        if (names) {
          return names.some((name) => name.toLowerCase().includes(query));
        }
        return false;
      });

      if (matchedEmojis.length > 0) {
        results[category] = matchedEmojis;
      }
    });

    return results;
  }, [searchQuery]);

  const hasResults =
    Object.keys(filteredCategories).length > 0 ||
    filteredCustomEmojis.length > 0;

  // --- Roving-tabindex grid navigation ---
  // The grid isn't a single native <table>/CSS-grid-with-role — categories
  // are independent fixed-column (8) CSS grids stacked in one scrollable
  // region, with no tab strip to jump between them (see file doc comment).
  // We model that as an ordered list of "sections" (custom emojis, then each
  // category) and let `computeNextEmojiGridPosition` do the row/column math;
  // only one cell is in the tab order (tabIndex 0) at a time, and arrow keys
  // move both the logical position and real DOM focus together.
  const gridSections: EmojiGridSection[] = useMemo(() => {
    const sections: EmojiGridSection[] = [];
    if (filteredCustomEmojis.length > 0) {
      sections.push({ key: CUSTOM_SECTION_KEY, count: filteredCustomEmojis.length });
    }
    Object.entries(filteredCategories).forEach(([name, emojis]) => {
      sections.push({ key: name, count: emojis.length });
    });
    return sections;
  }, [filteredCustomEmojis.length, filteredCategories]);

  const [activeCell, setActiveCell] = useState<EmojiGridPosition>(() => ({
    section: gridSections[0]?.key ?? '',
    index: 0,
  }));

  // Keep the active cell valid as the result set changes (typing a search
  // query can shrink/reorder sections out from under the current position).
  useEffect(() => {
    setActiveCell((prev) => {
      const stillValid = gridSections.find((s) => s.key === prev.section);
      if (stillValid && prev.index < stillValid.count) return prev;
      return { section: gridSections[0]?.key ?? '', index: 0 };
    });
  }, [gridSections]);

  const cellRefs = useRef<Record<string, (HTMLButtonElement | null)[]>>({});
  const setCellRef = useCallback(
    (sectionKey: string, index: number) => (el: HTMLButtonElement | null) => {
      const arr = (cellRefs.current[sectionKey] ??= []);
      arr[index] = el;
    },
    [],
  );

  const isActiveCell = useCallback(
    (sectionKey: string, index: number) =>
      activeCell.section === sectionKey && activeCell.index === index,
    [activeCell],
  );

  const handleCellFocus = useCallback(
    (sectionKey: string, index: number) => () => {
      setActiveCell({ section: sectionKey, index });
    },
    [],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isEmojiGridNavKey(event.key) || gridSections.length === 0) return;
      event.preventDefault();
      const next = computeNextEmojiGridPosition(event.key, activeCell, gridSections);
      if (next.section !== activeCell.section || next.index !== activeCell.index) {
        setActiveCell(next);
        cellRefs.current[next.section]?.[next.index]?.focus();
      }
    },
    [activeCell, gridSections],
  );

  return (
    <Box sx={{
      width: touch ? '100%' : '300px',
      height: touch ? '60vh' : '400px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header with Search */}
      <Box
        sx={{
          p: 1.5,
          pb: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <TextField
          size="small"
          placeholder="Search emojis..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          // Intentional: this is the first focusable control inside a
          // just-opened popover/sheet (not the page), matching the WAI-ARIA
          // pattern of moving focus into a newly-opened dialog/menu and
          // satisfying "search field first in tab order".
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          fullWidth
          sx={{
            '& .MuiOutlinedInput-root': {
              fontSize: 'scale.base',
              borderRadius: '8px',
              backgroundColor: 'action.hover',
              '& fieldset': {
                border: 'none',
              },
              '&:hover fieldset': {
                border: 'none',
              },
              '&.Mui-focused fieldset': {
                border: '1px solid',
                borderColor: 'primary.main',
              },
            },
            '& .MuiOutlinedInput-input': {
              padding: '8px 12px',
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 'icon.md', color: 'text.disabled' }} />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setSearchQuery('')}
                  sx={{ p: 0.5 }}
                >
                  <ClearIcon sx={{ fontSize: 'icon.sm' }} />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Scrollable Content */}
      <Box
        role="group"
        aria-label="Emojis"
        onKeyDown={handleGridKeyDown}
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: 1.5,
          py: 1,
          // Custom scrollbar styling
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '3px',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.3)',
            }
          },
        }}
      >
        {filteredCustomEmojis.length > 0 && (
          <Box role="group" aria-label="Custom" sx={{ mb: 1.5 }}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mb: 0.75,
                fontSize: 'scale.xs',
                fontWeight: 500,
                color: 'text.disabled',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Custom
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 1fr)',
                gap: '2px',
                width: '100%',
              }}
            >
              {filteredCustomEmojis.map((emoji, cellIndex) => (
                <IconButton
                  key={emoji.id}
                  ref={setCellRef(CUSTOM_SECTION_KEY, cellIndex)}
                  tabIndex={isActiveCell(CUSTOM_SECTION_KEY, cellIndex) ? 0 : -1}
                  onFocus={handleCellFocus(CUSTOM_SECTION_KEY, cellIndex)}
                  size="small"
                  title={`:${emoji.name}:`}
                  aria-label={`:${emoji.name}:`}
                  onClick={() => onCustomEmojiClick?.(emoji)}
                  sx={{
                    padding: touch ? '8px' : '4px',
                    borderRadius: '4px',
                    aspectRatio: '1',
                    minWidth: 'unset',
                    width: '100%',
                    height: 'auto',
                    transition: 'all 0.12s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      backgroundColor: 'rgba(88, 101, 242, 0.12)',
                      transform: 'scale(1.1)',
                    },
                  }}
                >
                  <img
                    src={getFileUrl(emoji.fileId) ?? undefined}
                    alt={`:${emoji.name}:`}
                    style={{
                      width: touch ? '24px' : '18px',
                      height: touch ? '24px' : '18px',
                      objectFit: 'contain',
                    }}
                  />
                </IconButton>
              ))}
            </Box>
          </Box>
        )}
        {hasResults ? (
          Object.entries(filteredCategories).map(([categoryName, emojis], index) => (
            <Box key={categoryName} role="group" aria-label={categoryName} sx={{ mb: 1.5 }}>
              {/* Category Header */}
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mb: 0.75,
                  mt: index === 0 ? 0 : 1,
                  fontSize: 'scale.xs',
                  fontWeight: 500,
                  color: 'text.disabled',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {searchQuery ? `${categoryName} (${emojis.length})` : categoryName}
              </Typography>

              {/* Emoji Grid */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(8, 1fr)',
                  gap: '2px',
                  width: '100%',
                }}
              >
                {emojis.map((emoji, cellIndex) => (
                  <IconButton
                    key={`${categoryName}-${emoji}`}
                    ref={setCellRef(categoryName, cellIndex)}
                    tabIndex={isActiveCell(categoryName, cellIndex) ? 0 : -1}
                    onFocus={handleCellFocus(categoryName, cellIndex)}
                    size="small"
                    aria-label={EMOJI_NAMES[emoji]?.[0] ?? emoji}
                    onClick={() => onEmojiClick(emoji)}
                    sx={{
                      fontSize: touch ? '24px' : '16px',
                      padding: touch ? '8px' : '4px',
                      borderRadius: '4px',
                      aspectRatio: '1',
                      minWidth: 'unset',
                      width: '100%',
                      height: 'auto',
                      transition: 'all 0.12s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        backgroundColor: 'rgba(88, 101, 242, 0.12)',
                        transform: 'scale(1.1)',
                      },
                      '&:active': {
                        transform: 'scale(0.95)',
                        transition: 'all 0.05s ease',
                      }
                    }}
                  >
                    {emoji}
                  </IconButton>
                ))}
              </Box>
            </Box>
          ))
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              color: 'text.disabled',
            }}
          >
            <Typography variant="body2">No emojis found</Typography>
            <Typography variant="caption" sx={{ mt: 0.5 }}>
              Try a different search term
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export interface EmojiPickerPopoverProps {
  open: boolean;
  /** Screen-coordinate anchor (used by MessageContextMenu). */
  anchorPosition?: { top: number; left: number } | null;
  /** Element anchor (used by the composer emoji button); opens above the anchor. */
  anchorEl?: HTMLElement | null;
  onClose: () => void;
  onEmojiSelect: (emoji: string) => void;
  /** When set, a "Custom" section shows this community's emojis (channels only). */
  communityId?: string | null;
  /** Called when a custom emoji is picked (composer inserts `:name:`, reactions send the sentinel). */
  onCustomEmojiSelect?: (emoji: CustomEmojiDto) => void;
  /** Sheet title on touch devices. */
  title?: string;
}

/**
 * Controlled emoji picker popover.
 * - `anchorEl` anchors to an element and opens above it (composer emoji button).
 * - `anchorPosition` positions at arbitrary screen coordinates (MessageContextMenu).
 * On touch devices it renders as a full-width bottom sheet regardless.
 */
export const EmojiPickerPopover: React.FC<EmojiPickerPopoverProps> = ({
  open,
  anchorPosition,
  anchorEl,
  onClose,
  onEmojiSelect,
  communityId,
  onCustomEmojiSelect,
  title = 'Add Reaction',
}) => {
  const { shouldUseTouchUI } = useResponsive();
  const { emojis: customEmojis } = useCommunityCustomEmojis(
    onCustomEmojiSelect ? communityId : undefined,
  );

  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
    onClose();
  };

  const handleCustomEmojiClick = (emoji: CustomEmojiDto) => {
    onCustomEmojiSelect?.(emoji);
    onClose();
  };

  const contentProps = {
    onEmojiClick: handleEmojiClick,
    customEmojis,
    onCustomEmojiClick: onCustomEmojiSelect ? handleCustomEmojiClick : undefined,
  };

  // On touch devices, present the picker as a full-width bottom sheet instead
  // of a small anchored popover.
  if (shouldUseTouchUI) {
    return (
      <MobileSheet open={open} onClose={onClose} title={title} maxHeight="70vh">
        <EmojiPickerContent {...contentProps} touch />
      </MobileSheet>
    );
  }

  // Element-anchored popover that opens upward (e.g. above a composer button).
  if (anchorEl) {
    return (
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={onClose}
        // Without this, the Modal's focus trap re-focuses the emoji BUTTON
        // when the exit transition finishes — clobbering the composer's
        // caret/focus restore after inserting an emoji.
        disableRestoreFocus
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <EmojiPickerContent {...contentProps} />
      </Popover>
    );
  }

  return (
    <Popover
      open={open}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      onClose={onClose}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
    >
      <EmojiPickerContent {...contentProps} />
    </Popover>
  );
};

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  /** When set, a "Custom" section shows this community's emojis (channels only). */
  communityId?: string | null;
  /** Called when a custom emoji is picked. */
  onCustomEmojiSelect?: (emoji: CustomEmojiDto) => void;
}

/**
 * Self-contained emoji picker with its own trigger button.
 * Used in the message hover toolbar.
 */
export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onEmojiSelect,
  communityId,
  onCustomEmojiSelect,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const { emojis: customEmojis } = useCommunityCustomEmojis(
    onCustomEmojiSelect ? communityId : undefined,
  );

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
    handleClose();
  };

  const handleCustomEmojiClick = (emoji: CustomEmojiDto) => {
    onCustomEmojiSelect?.(emoji);
    handleClose();
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <IconButton
        size="small"
        onClick={handleClick}
        aria-label="Add reaction"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <AddReactionIcon fontSize="small" />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <EmojiPickerContent
          onEmojiClick={handleEmojiClick}
          customEmojis={customEmojis}
          onCustomEmojiClick={onCustomEmojiSelect ? handleCustomEmojiClick : undefined}
        />
      </Popover>
    </>
  );
};