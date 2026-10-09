import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import {
  FormPageShell,
  ListPageShell,
  StickySaveBar,
  useSaveBarSlot,
} from '../../components/Common/PageShell';

const SECTIONS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma', disabled: true },
];

const SlotProbe = () => <span data-testid="slot">{useSaveBarSlot() ? 'slot' : 'none'}</span>;

describe('ListPageShell', () => {
  it('caps the page at 960px with a title', () => {
    renderWithProviders(<ListPageShell title="Notifications">body</ListPageShell>);
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByTestId('list-page-shell')).toHaveStyle({ maxWidth: '960px' });
  });
});

describe('FormPageShell', () => {
  it('renders the section nav and marks the active section', () => {
    renderWithProviders(
      <FormPageShell title="Settings" sections={SECTIONS} activeSection="b" navLabel="Settings sections">
        body
      </FormPageShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Alpha' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeDisabled();
  });

  it('reports section clicks', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <FormPageShell sections={SECTIONS} activeSection="a" onSelectSection={onSelect}>
        body
      </FormPageShell>,
    );
    await user.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('has no nav without sections', () => {
    renderWithProviders(<FormPageShell>body</FormPageShell>);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('gives forms a save-bar slot; outside the shell there is none', () => {
    const { unmount } = renderWithProviders(
      <FormPageShell>
        <SlotProbe />
      </FormPageShell>,
    );
    expect(screen.getByTestId('slot')).toHaveTextContent('slot');
    unmount();
    renderWithProviders(<SlotProbe />);
    expect(screen.getByTestId('slot')).toHaveTextContent('none');
  });
});

describe('StickySaveBar', () => {
  it('offers Reset and Save', async () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    const { user } = renderWithProviders(<StickySaveBar onSave={onSave} onReset={onReset} />);
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('You have unsaved changes');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disables both while saving', () => {
    renderWithProviders(<StickySaveBar saving onSave={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});
