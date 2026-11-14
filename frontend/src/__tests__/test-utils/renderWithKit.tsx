import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import userEvent from '@testing-library/user-event';
import { KitProvider } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';

interface RenderWithKitOptions extends Omit<RenderOptions, 'wrapper'> {
  base?: string;
  mode?: ModeName;
  intensity?: IntensityName;
}

/** Renders `ui` inside a KitProvider, with the kit's defaults unless overridden. */
export function renderWithKit(ui: React.ReactElement, options: RenderWithKitOptions = {}) {
  const { base = '#8E75FF', mode = 'dark', intensity = 'minimal', ...renderOptions } = options;

  const user = userEvent.setup();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ThemeProvider theme={createTheme()}>
        <KitProvider base={base} mode={mode} intensity={intensity}>
          {children}
        </KitProvider>
      </ThemeProvider>
    );
  }

  const renderResult = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    user,
    ...renderResult,
  };
}
