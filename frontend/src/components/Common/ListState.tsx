/**
 * ListState
 *
 * One place for the four states every server-backed list has:
 *
 *   loading  → a skeleton (never the empty copy)
 *   error    → "Couldn't load …" with a Try again button (never the empty copy)
 *   empty    → the caller's empty node
 *   data     → children
 *
 * A failed *refetch* while data is already on screen keeps showing the stale
 * data: the error branch only wins when there is nothing to show (`isEmpty`).
 *
 * ```tsx
 * <ListState
 *   isLoading={isLoading}
 *   error={error}
 *   onRetry={() => void refetch()}
 *   isEmpty={items.length === 0}
 *   empty={<EmptyState variant="dm" />}
 *   errorTitle="Couldn't load conversations"
 * >
 *   <List>…</List>
 * </ListState>
 * ```
 */
import React from 'react';
import { Box, Button, List, ListItem, ListItemAvatar, ListItemText, Skeleton, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { ErrorOutline as ErrorIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { useResponsive } from '../../hooks/useResponsive';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

export type ListStateSize = 'regular' | 'compact';

export interface ListStateProps {
  isLoading: boolean;
  /** The query error. Shown only while there is nothing else to show (`isEmpty`). */
  error?: unknown;
  /** Retry handler; without it the error state has no button. */
  onRetry?: () => void;
  /** True when there are no items to render (also true while errored with no data). */
  isEmpty: boolean;
  /** Rendered when loaded and empty. */
  empty?: React.ReactNode;
  /** Rendered while loading. Defaults to `<ListSkeleton />`. */
  skeleton?: React.ReactNode;
  errorTitle?: string;
  errorDescription?: string;
  /** `compact` for narrow side panels (member list, thread). */
  size?: ListStateSize;
  children?: React.ReactNode;
}

interface ListSkeletonProps {
  rows?: number;
  /** Circular avatar size in px; 0 hides the avatar column. */
  avatarSize?: number;
  /** Accessible name of the loading indicator. */
  label?: string;
}

/**
 * Generic list skeleton: avatar + two text lines per row. Exposed as an
 * indeterminate progressbar so assistive tech (and tests) know it's loading.
 */
export const ListSkeleton: React.FC<ListSkeletonProps> = ({ rows = 6, avatarSize = 40, label = 'Loading' }) => (
  <List disablePadding role="progressbar" aria-label={label} aria-busy="true">
    {Array.from({ length: rows }).map((_, index) => (
      <ListItem key={index} sx={{ py: 1 }}>
        {avatarSize > 0 && (
          <ListItemAvatar sx={{ minWidth: avatarSize + 16 }}>
            <Skeleton variant="circular" width={avatarSize} height={avatarSize} />
          </ListItemAvatar>
        )}
        <ListItemText
          primary={<Skeleton variant="text" width={`${55 + ((index * 17) % 30)}%`} />}
          secondary={<Skeleton variant="text" width={`${30 + ((index * 23) % 35)}%`} />}
        />
      </ListItem>
    ))}
  </List>
);

interface ListErrorProps {
  title: string;
  description: string;
  onRetry?: () => void;
  size: ListStateSize;
}

const ListError: React.FC<ListErrorProps> = ({ title, description, onRetry, size }) => {
  const theme = useTheme();
  const { shouldUseTouchUI } = useResponsive();
  const compact = size === 'compact';
  const circle = compact ? 56 : 96;

  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: compact ? 3 : 6,
        px: compact ? 2 : 3,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: circle,
          height: circle,
          borderRadius: '50%',
          mb: compact ? 1.5 : 2.5,
          bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
          color: theme.palette.error.main,
        }}
      >
        <ErrorIcon sx={{ fontSize: compact ? 28 : 48 }} />
      </Box>
      <Typography
        variant={compact ? 'subtitle2' : 'h6'}
        sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}
      >
        {title}
      </Typography>
      <Typography
        variant={compact ? 'caption' : 'body2'}
        sx={{ color: 'text.secondary', maxWidth: 300, mb: onRetry ? (compact ? 1.5 : 2.5) : 0 }}
      >
        {description}
      </Typography>
      {onRetry && (
        <Button
          variant={compact ? 'outlined' : 'contained'}
          size={compact ? 'small' : 'medium'}
          startIcon={<RefreshIcon />}
          onClick={onRetry}
          sx={{
            borderRadius: 2,
            px: compact ? 2 : 3,
            ...(shouldUseTouchUI && { minHeight: TOUCH_TARGETS.MINIMUM }),
          }}
        >
          Try again
        </Button>
      )}
    </Box>
  );
};

const ListState: React.FC<ListStateProps> = ({
  isLoading,
  error,
  onRetry,
  isEmpty,
  empty = null,
  skeleton,
  errorTitle = "Couldn't load this list",
  errorDescription = 'Something went wrong. Check your connection and try again.',
  size = 'regular',
  children,
}) => {
  if (isLoading) {
    return <>{skeleton ?? <ListSkeleton />}</>;
  }
  if (error && isEmpty) {
    return <ListError title={errorTitle} description={errorDescription} onRetry={onRetry} size={size} />;
  }
  if (isEmpty) {
    return <>{empty}</>;
  }
  return <>{children}</>;
};

export default ListState;
