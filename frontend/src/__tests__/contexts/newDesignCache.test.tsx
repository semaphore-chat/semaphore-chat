/**
 * forgetNewDesignSetting (M4): the browser's copy of the "new design" account setting is dropped
 * on logout and when the server ends the session, in the mounted ThemeProvider too, without
 * telling the server (the account keeps its value).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { ThemeProvider, useNewDesignSetting, useTheme } from '../../contexts/ThemeContext';
import { forgetNewDesignSetting } from '../../contexts/newDesignCache';
import { STORAGE_KEY } from '../../theme/constants';
import { createTestQueryClient } from '../test-utils';

const changes: unknown[] = [];

function Probe() {
  const { registerOnChange } = useTheme();
  useEffect(() => registerOnChange((settings) => changes.push(settings)), [registerOnChange]);
  return <span data-testid="new-design">{String(useNewDesignSetting())}</span>;
}

beforeEach(() => {
  localStorage.clear();
  changes.length = 0;
});

describe('forgetNewDesignSetting', () => {
  it('turns the setting off in the provider and in storage, and sends nothing to the server', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark', newDesign: true }));
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('new-design')).toHaveTextContent('true');
    // Let the provider's own first effects run (they notify listeners once, as on any mount).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    changes.length = 0;

    await act(async () => {
      forgetNewDesignSetting(createTestQueryClient());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId('new-design')).toHaveTextContent('false');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ newDesign: false });
    // useThemeSync sends a change to the server from these callbacks: none may fire.
    expect(changes).toEqual([]);
  });

  it('leaves a browser with the setting off as it is', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'light' }));
    forgetNewDesignSetting(createTestQueryClient());
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ mode: 'light' }));
  });
});
