import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Avatar,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  useTheme,
  alpha,
  styled,
} from '@mui/material';
import {
  Notifications as NotificationIcon,
  Group as GroupIcon,
} from '@mui/icons-material';
import { MentionSuggestion } from '../../hooks/useMentionAutocomplete';
import UserAvatar from '../Common/UserAvatar';
import { MENTION_LISTBOX_ID, mentionOptionId } from './mentionDropdownIds';
import { useResponsive } from '../../hooks/useResponsive';

const DropdownPaper = styled(Paper)(({ theme }) => ({
  position: 'absolute',
  minWidth: 280,
  maxWidth: 360,
  zIndex: 2000,
  backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.background.paper, 0.95)}, ${alpha(theme.palette.background.paper, 0.85)})`,
  backdropFilter: 'blur(20px)',
  borderRadius: Number(theme.shape.borderRadius) * 3,
  border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
  boxShadow: `
    0 8px 32px ${alpha(theme.palette.common.black, 0.12)},
    0 2px 8px ${alpha(theme.palette.common.black, 0.08)},
    inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}
  `,
  '&::before': {
    content: '""',
    position: 'absolute',
    bottom: -8,
    left: 24,
    width: 0,
    height: 0,
    borderLeft: '8px solid transparent',
    borderRight: '8px solid transparent',
    borderTop: `8px solid ${alpha(theme.palette.background.paper, 0.95)}`,
    filter: `drop-shadow(0 2px 4px ${alpha(theme.palette.common.black, 0.1)})`,
  },
}));

interface MentionDropdownProps {
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  isLoading: boolean;
  onSelectSuggestion: (index: number) => void;
  /**
   * Override placement. By default the dropdown sits directly above the
   * composer (its positioned parent), whatever height the composer has grown
   * to (reply banner, file tray, multi-line draft).
   */
  position?: { top?: number | string; bottom?: number | string; left: number | string; right?: number | string };
}

/** Directly above the composer box, 8px gap (room for the arrow). */
const ABOVE_COMPOSER = { bottom: 'calc(100% + 8px)', left: 20 };
/** Phone: full composer width, so names and subtitles fit on one line. */
const ABOVE_COMPOSER_PHONE = { bottom: 'calc(100% + 8px)', left: 8, right: 8 };

export const MentionDropdown: React.FC<MentionDropdownProps> = ({
  suggestions,
  selectedIndex,
  isLoading,
  onSelectSuggestion,
  position,
}) => {
  const theme = useTheme();
  const { isMobile } = useResponsive();
  const placement = position ?? (isMobile ? ABOVE_COMPOSER_PHONE : ABOVE_COMPOSER);
  // On phone the dropdown is full width and drops the keyboard-hint footer so
  // at least 5 rows fit inside 40% of the viewport (even a short one with the
  // on-screen keyboard up).
  const phoneSx = isMobile ? { minWidth: 0, maxWidth: 'none' } : {};

  if (isLoading) {
    return (
      <DropdownPaper
        elevation={8}
        role="status"
        data-testid="mention-dropdown"
        sx={{
          ...placement,
          ...phoneSx,
          p: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress size={20} thickness={4} />
        <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
          Searching...
        </Typography>
      </DropdownPaper>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <DropdownPaper
      elevation={8}
      data-testid="mention-dropdown"
      data-placement={position ? 'custom' : 'above-composer'}
      data-layout={isMobile ? 'phone' : 'desktop'}
      sx={{
        ...placement,
        ...phoneSx,
        // Cap height so the dropdown can never overflow the top of small
        // screens: at most 40% of the viewport.
        maxHeight: isMobile ? '40vh' : 'min(320px, 40vh)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: isMobile ? 0.75 : 1.5,
          flexShrink: 0,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
          background: alpha(theme.palette.primary.main, 0.02),
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {(() => {
            const types = new Set(suggestions.map(s => s.type));
            if (types.size === 1) {
              if (types.has('user')) return 'Members';
              if (types.has('alias')) return 'Mention Groups';
              return 'Special Mentions';
            }
            return 'Suggestions';
          })()}
        </Typography>
      </Box>

      {/* Suggestions List */}
      <List
        id={MENTION_LISTBOX_ID}
        role="listbox"
        aria-label="Mention suggestions"
        sx={{
          p: 0.5,
          flex: 1,
          minHeight: 0,
          maxHeight: isMobile ? 'none' : 260,
          overflow: 'auto',
          '&::-webkit-scrollbar': {
            width: 4,
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: alpha(theme.palette.text.secondary, 0.2),
            borderRadius: 2,
          },
        }}
      >
        {suggestions.map((suggestion, index) => (
          <ListItem
            key={suggestion.id}
            id={mentionOptionId(index)}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelectSuggestion(index)}
            sx={{
              borderRadius: 2,
              mb: isMobile ? 0 : 0.25,
              py: isMobile ? 0 : undefined,
              // Comfortable touch target (desktop rows already sit ~48px, so no
              // visible density change there).
              minHeight: 44,
              cursor: 'pointer',
              transition: 'all 0.15s ease-in-out',
              backgroundImage: index === selectedIndex
                ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.primary.main, 0.04)})`
                : 'none',
              transform: index === selectedIndex ? 'translateX(2px)' : 'none',
              borderLeft: index === selectedIndex
                ? `3px solid ${theme.palette.primary.main}`
                : '3px solid transparent',
              '&:hover': {
                backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.06)}, ${alpha(theme.palette.primary.main, 0.03)})`,
                transform: 'translateX(1px)',
              },
              '&:active': {
                transform: 'translateX(3px) scale(0.98)',
              },
            }}
          >
            <ListItemAvatar
              sx={{
                minWidth: 40,
                mr: 1,
              }}
            >
              {suggestion.type === 'user' ? (
                <Box
                  sx={{
                    border: index === selectedIndex
                      ? `2px solid ${alpha(theme.palette.primary.main, 0.5)}`
                      : `2px solid ${alpha(theme.palette.divider, 0.1)}`,
                    transition: 'border 0.15s ease-in-out',
                    borderRadius: '50%',
                  }}
                >
                  <UserAvatar
                    userId={suggestion.id}
                    size="small"
                  />
                </Box>
              ) : suggestion.type === 'alias' ? (
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    bgcolor: alpha(theme.palette.warning.main, 0.1),
                    color: 'warning.main',
                    border: index === selectedIndex
                      ? `2px solid ${alpha(theme.palette.warning.main, 0.5)}`
                      : `2px solid ${alpha(theme.palette.divider, 0.1)}`,
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  <GroupIcon fontSize="small" />
                </Avatar>
              ) : (
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    bgcolor: alpha(theme.palette.success.main, 0.1),
                    color: 'success.main',
                    border: index === selectedIndex
                      ? `2px solid ${alpha(theme.palette.success.main, 0.5)}`
                      : `2px solid ${alpha(theme.palette.divider, 0.1)}`,
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  <NotificationIcon fontSize="small" />
                </Avatar>
              )}
            </ListItemAvatar>
            <ListItemText
              primary={
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: index === selectedIndex ? 600 : 500,
                    color: index === selectedIndex
                      ? 'primary.main'
                      : 'text.primary',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  @{suggestion.displayName}
                </Typography>
              }
              secondary={
                suggestion.subtitle && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'text.secondary',
                      opacity: 0.8,
                    }}
                  >
                    {suggestion.subtitle}
                  </Typography>
                )
              }
              sx={{
                my: isMobile ? 0 : undefined,
                minWidth: 0,
                // Phone: name and @handle on one line so every row is 44px.
                ...(isMobile && {
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  '& > *': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  '& > :first-of-type': { flexShrink: 0, maxWidth: '60%' },
                }),
                '& .MuiListItemText-primary': {
                  lineHeight: 1.3,
                  mb: suggestion.subtitle && !isMobile ? 0.25 : 0,
                },
                '& .MuiListItemText-secondary': {
                  lineHeight: 1.2,
                },
              }}
            />
          </ListItem>
        ))}
      </List>

      {/* Footer hint (keyboard only — meaningless on a phone) */}
      {!isMobile && (
      <Box
        sx={{
          px: 2,
          py: 1,
          flexShrink: 0,
          borderTop: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
          background: alpha(theme.palette.background.paper, 0.3),
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontSize: 'scale.xs',
            opacity: 0.6,
          }}
        >
          ↑↓ Navigate • Enter/Tab Select • Esc Close
        </Typography>
      </Box>
      )}
    </DropdownPaper>
  );
};