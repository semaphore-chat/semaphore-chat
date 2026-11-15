/**
 * The new shell's error boundary around a screen (or a screen's centre). Kit-free and without the
 * old app's ErrorBoundary, which lives in components/ (outside the new shell's import boundary).
 * It clears its error when `resetKey` changes (another path), so the frame around it stays mounted.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../../../utils/logger';

interface ScreenBoundaryProps {
  /** A change clears a caught error: the route's path. */
  resetKey: string;
  /** What shows instead; a function gets `reset`, which clears the error and renders the children again. */
  fallback: ReactNode | ((reset: () => void) => ReactNode);
  children: ReactNode;
}

interface ScreenBoundaryState {
  error: unknown;
  /** The key the error was caught under. */
  key: string | null;
}

export class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  state: ScreenBoundaryState = { error: null, key: null };

  static getDerivedStateFromError(error: unknown): Partial<ScreenBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: ScreenBoundaryProps, state: ScreenBoundaryState): Partial<ScreenBoundaryState> | null {
    if (state.error !== null && state.key !== null && state.key !== props.resetKey) {
      return { error: null, key: null };
    }
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({ key: this.props.resetKey });
    logger.error('[Lounge] A screen crashed:', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null, key: null });
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === 'function' ? fallback(this.reset) : fallback;
  }
}
