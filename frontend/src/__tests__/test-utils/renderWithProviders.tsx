import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { SocketContext } from '../../utils/SocketContext';
import { NotificationProvider } from '../../contexts/NotificationContext';
import { ElectronProvider } from '../../contexts/ElectronProvider';
import type { ElectronAPI } from '../../types/electron-api';
import { generateTheme } from '../../theme/themeConfig';
import { createTestQueryClient } from './queryClient';
import type { MockSocket } from './mockSocket';

const defaultTheme = generateTheme('dark', 'blue', 'balanced');

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
  socket?: MockSocket | null;
  isSocketConnected?: boolean;
  routerProps?: MemoryRouterProps;
  withRouter?: boolean;
  withTheme?: boolean;
  /**
   * The Electron bridge `useElectronAPI()` returns in this tree (wraps it in
   * an `ElectronProvider`): e.g. `createFakeElectronAPI({...})`, or `null` for
   * a web browser. Omit to leave `useElectronAPI()` on `getElectronAPI()`.
   * Non-React code (`isElectron()`, tokenService) doesn't see it; fake that
   * with `setElectronAPIOverride()`.
   */
  electronAPI?: ElectronAPI | null;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  const {
    queryClient = createTestQueryClient(),
    socket = null,
    isSocketConnected = socket ? true : false,
    routerProps = {},
    withRouter = true,
    withTheme = true,
    electronAPI,
    ...renderOptions
  } = options;

  const user = userEvent.setup();

  function Wrapper({ children }: { children: React.ReactNode }) {
    let content = <>{children}</>;

    // NotificationProvider wraps children (renders Snackbar for assertions)
    content = <NotificationProvider>{content}</NotificationProvider>;

    if (electronAPI !== undefined) {
      content = <ElectronProvider api={electronAPI}>{content}</ElectronProvider>;
    }

    // Socket context
    content = (
      <SocketContext.Provider
        value={{ socket: socket as never, isConnected: socket ? isSocketConnected : false }}
      >
        {content}
      </SocketContext.Provider>
    );

    // Router (MemoryRouter for test control)
    if (withRouter) {
      content = <MemoryRouter {...routerProps}>{content}</MemoryRouter>;
    }

    // Theme (MUI needs this to render)
    if (withTheme) {
      content = <ThemeProvider theme={defaultTheme}>{content}</ThemeProvider>;
    }

    // QueryClient
    content = (
      <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
    );

    return content;
  }

  const renderResult = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    user,
    queryClient,
    ...renderResult,
  };
}
