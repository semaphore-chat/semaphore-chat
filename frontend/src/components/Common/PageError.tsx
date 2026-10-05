import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LockOutlined as LockIcon, SearchOff as NotFoundIcon } from '@mui/icons-material';
import { ErrorState } from './ListState';
import { getPageErrorInfo, type PageErrorCopySet } from '../../utils/pageError';

interface PageErrorProps {
  error: unknown;
  copy: PageErrorCopySet;
  /** Retry handler; offered only for server faults (a 403/404 won't change). */
  onRetry?: () => void;
  /** Where "Go home" leads. */
  homePath?: string;
  /** Centre in the available height (a full page) rather than inline. */
  fullHeight?: boolean;
}

/**
 * The full-page error state for a failure above the channel level: the right
 * message per status (no access / not found / server error), "Try again"
 * where retrying can help, and "Go home" where it can't.
 */
const PageError: React.FC<PageErrorProps> = ({ error, copy, onRetry, homePath = '/', fullHeight = true }) => {
  const navigate = useNavigate();
  const info = getPageErrorInfo(error, copy);
  const icon =
    info.kind === 'forbidden' ? (
      <LockIcon sx={{ fontSize: 48 }} />
    ) : info.kind === 'not-found' ? (
      <NotFoundIcon sx={{ fontSize: 48 }} />
    ) : undefined;

  return (
    <ErrorState
      title={info.title}
      description={info.description}
      icon={icon}
      fullHeight={fullHeight}
      onRetry={info.retryable ? onRetry : undefined}
      secondaryAction={{ label: 'Go home', onClick: () => navigate(homePath) }}
    />
  );
};

export default PageError;
