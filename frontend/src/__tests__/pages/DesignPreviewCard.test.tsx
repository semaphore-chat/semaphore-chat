/**
 * The design preview card (/debug/design): the switch saves the new design to
 * the account through the theme settings; the tab's preview override is shown
 * and can be cleared.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';
import { DesignPreviewCard } from '../../pages/debug/PWADebugPage';
import { clearDesignPreview, readDesignPreview, setDesignPreview } from '../../shell/designPreview';

let newDesign: boolean | undefined;
function SettingProbe() {
  newDesign = useTheme().newDesign;
  return null;
}

function renderCard() {
  return renderWithProviders(
    <ThemeProvider>
      <SettingProbe />
      <DesignPreviewCard />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  clearDesignPreview();
  newDesign = undefined;
});

describe('DesignPreviewCard', () => {
  it('the switch turns the new design on and off in the account setting (setNewDesign)', async () => {
    const { user } = renderCard();
    const toggle = screen.getByLabelText('New design (saved to your account)');
    expect(toggle).not.toBeChecked();
    expect(newDesign).toBe(false);

    await user.click(toggle);
    expect(newDesign).toBe(true);
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(newDesign).toBe(false);
    // The tab's preview is untouched by the account switch.
    expect(readDesignPreview()).toBeNull();
  });

  it("shows this tab's override and clears it", async () => {
    setDesignPreview('lounge');
    const { user } = renderCard();
    expect(screen.getByTestId('design-preview-override')).toHaveTextContent('New design, for this tab only');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(readDesignPreview()).toBeNull();
    expect(screen.getByTestId('design-preview-override')).toHaveTextContent('Follows your account');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('follows an override set elsewhere in the tab', () => {
    renderCard();
    expect(screen.getByTestId('design-preview-override')).toHaveTextContent('Follows your account');
    act(() => setDesignPreview('classic'));
    expect(screen.getByTestId('design-preview-override')).toHaveTextContent('Old design, for this tab only');
  });

  it('links to the preview screen', () => {
    renderCard();
    expect(screen.getByRole('link', { name: "Open the new design's preview screen" })).toHaveAttribute('href', '/__lounge');
  });
});
