import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { renderWithProviders } from '../test-utils';
import { THEME_MATRIX } from '../test-utils/themeMatrix';
import { generateTheme } from '../../theme/themeConfig';
import { FilePreview } from '../../components/Message/FilePreview';

describe('FilePreview file chips', () => {
  it.each(THEME_MATRIX)('styles file chips neutrally, not with the accent tint ($mode + $intensity)', (entry) => {
    const theme = generateTheme(entry.mode, 'blue', entry.intensity);
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    renderWithProviders(
      <ThemeProvider theme={theme}>
        <FilePreview files={[file]} previews={new Map()} onRemoveFile={vi.fn()} />
      </ThemeProvider>,
    );
    const chip = screen.getByTestId('pending-file-chip');
    expect(chip).toHaveClass('MuiChip-root');
    const style = getComputedStyle(chip);
    // Probe elements resolve the neutral tokens to the same rgba() strings.
    const probe = (color: string) => {
      const el = document.createElement('div');
      el.style.color = color;
      document.body.appendChild(el);
      const resolved = getComputedStyle(el).color;
      el.remove();
      return resolved;
    };
    expect(style.backgroundColor).toBe(probe(theme.palette.action.selected));
    expect(style.color).toBe(probe(theme.palette.text.primary));
    expect(style.backgroundColor).not.toBe(probe(theme.palette.primary.main));
  });

  it('removes a file from its chip', async () => {
    const onRemoveFile = vi.fn();
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    const { user } = renderWithProviders(
      <FilePreview files={[file]} previews={new Map()} onRemoveFile={onRemoveFile} />,
    );
    await user.click(screen.getByTestId('CloseIcon'));
    expect(onRemoveFile).toHaveBeenCalledWith(0);
  });
});
