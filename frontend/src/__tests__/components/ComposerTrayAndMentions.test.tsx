/**
 * Composer satellites (mobile UX overhaul, task 11): the file preview tray
 * and the mention dropdown's phone layout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, render, within } from '@testing-library/react';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import { FilePreview } from '../../components/Message/FilePreview';
import { MentionDropdown } from '../../components/Message/MentionDropdown';
import type { MentionSuggestion } from '../../hooks/useMentionAutocomplete';

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

const PHONE = { isMobile: true, shouldUseTouchUI: true, isTouchDevice: true };
const DESKTOP = { isMobile: false, shouldUseTouchUI: false, isTouchDevice: false };
const mockResponsive = vi.fn(() => DESKTOP);
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive(),
}));

const LONG_NAME = 'delivery-queue-consumer-heap-dump-production-eu-west-1.zip';

function files(): File[] {
  return [
    new File(['a'], 'photo.png', { type: 'image/png' }),
    new File(['b'], LONG_NAME, { type: 'application/zip' }),
    new File(['c'], 'notes.pdf', { type: 'application/pdf' }),
  ];
}

describe('FilePreview tray', () => {
  it('renders files in one horizontally scrolling, framed tray', () => {
    render(<FilePreview files={files()} previews={new Map([[0, 'blob:photo']])} onRemoveFile={vi.fn()} />);
    const tray = screen.getByRole('list', { name: /attachments/i });
    expect(tray).toHaveStyle({ overflowX: 'auto', flexWrap: 'nowrap' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(3);
  });

  it('truncates long file names and keeps the full name available', () => {
    render(<FilePreview files={files()} previews={new Map()} onRemoveFile={vi.fn()} />);
    const chip = screen.getByTitle(LONG_NAME);
    expect(chip).toBeInTheDocument();
    const label = chip.querySelector('.MuiChip-label') as HTMLElement;
    expect(label).toHaveStyle({ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' });
  });

  it('removes a file from its remove button', async () => {
    const onRemove = vi.fn();
    render(<FilePreview files={files()} previews={new Map([[0, 'blob:photo']])} onRemoveFile={onRemove} />);
    // Image thumbnail: labelled remove button.
    screen.getByRole('button', { name: 'remove photo.png' }).click();
    expect(onRemove).toHaveBeenCalledWith(0);
    // File chip: its delete icon.
    const chip = screen.getByTitle(LONG_NAME);
    (chip.querySelector('.MuiChip-deleteIcon') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('renders nothing with no files', () => {
    const { container } = render(<FilePreview files={[]} previews={new Map()} onRemoveFile={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every theme', () => {
    renderInEveryTheme(
      () => <FilePreview files={files()} previews={new Map()} onRemoveFile={vi.fn()} />,
      (result) => {
        expect(result.getByRole('list', { name: /attachments/i })).toBeInTheDocument();
      },
    );
  });
});

function suggestions(n: number): MentionSuggestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u-${i}`,
    type: 'user' as const,
    displayName: `Member ${i}`,
    subtitle: `@member${i}`,
  }));
}

describe('MentionDropdown', () => {
  beforeEach(() => {
    mockResponsive.mockReturnValue(DESKTOP);
  });

  it('sits directly above the composer by default', () => {
    render(<MentionDropdown suggestions={suggestions(3)} selectedIndex={0} isLoading={false} onSelectSuggestion={vi.fn()} />);
    const paper = screen.getByTestId('mention-dropdown');
    expect(paper).toHaveAttribute('data-placement', 'above-composer');
  });

  it('keeps the keyboard hint footer on desktop', () => {
    render(<MentionDropdown suggestions={suggestions(3)} selectedIndex={0} isLoading={false} onSelectSuggestion={vi.fn()} />);
    expect(screen.getByText(/navigate/i)).toBeInTheDocument();
  });

  it('on phone: drops the keyboard hint and spans the composer width, so rows get the height', () => {
    mockResponsive.mockReturnValue(PHONE);
    render(<MentionDropdown suggestions={suggestions(8)} selectedIndex={0} isLoading={false} onSelectSuggestion={vi.fn()} />);
    expect(screen.queryByText(/navigate/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(8);
    const paper = screen.getByTestId('mention-dropdown');
    expect(paper).toHaveAttribute('data-layout', 'phone');
  });

  it('renders in every theme (phone and desktop)', () => {
    for (const r of [PHONE, DESKTOP]) {
      mockResponsive.mockReturnValue(r);
      renderInEveryTheme(
        () => <MentionDropdown suggestions={suggestions(6)} selectedIndex={1} isLoading={false} onSelectSuggestion={vi.fn()} />,
        (result) => {
          expect(result.getAllByRole('option')).toHaveLength(6);
        },
      );
    }
  });
});
