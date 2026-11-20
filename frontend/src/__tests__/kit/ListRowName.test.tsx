/**
 * ListRow's accessible name carries what the row shows (PR 6 review I4): ", unread" and the trailing slot's meaning
 * (`trailingLabel`), before the second line. A row without either keeps its old name.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Badge, ListRow, Pill } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('ListRow name', () => {
  it('a plain link row is named by its lines, as before', () => {
    renderWithKit(<ListRow primary="Couch Co-op" secondary="Quiet" href="#a" />);
    expect(screen.getByRole('link', { name: 'Couch Co-op Quiet' })).toBeInTheDocument();
  });

  it('unread and the trailing badge are in the name: "clips, unread, 2 mentions"', () => {
    renderWithKit(
      <ListRow primary="clips" unread href="#clips" trailing={<Badge count={2} tone="accent" label="2 mentions" />} trailingLabel="2 mentions" />,
    );
    expect(screen.getByRole('link', { name: 'clips, unread, 2 mentions' })).toBeInTheDocument();
  });

  it('the role comes before the second line: "Samira, admin, keeping the server warm"', () => {
    renderWithKit(
      <ListRow size="lg" primary="Samira" secondary="keeping the server warm" onClick={() => undefined} trailing={<Pill size="sm">admin</Pill>} trailingLabel="admin" />,
    );
    expect(screen.getByRole('button', { name: 'Samira, admin, keeping the server warm' })).toBeInTheDocument();
  });

  it('a selected row does not say unread (it shows no unread mark)', () => {
    renderWithKit(<ListRow primary="general" unread selected href="#general" />);
    expect(screen.getByRole('link', { name: 'general' })).toBeInTheDocument();
  });

  it('the added words are hidden from the eye', () => {
    renderWithKit(<ListRow primary="clips" unread href="#clips" trailingLabel="2 mentions" />);
    const hidden = Array.from(screen.getByRole('link').querySelectorAll('span')).find((el) => el.textContent?.startsWith(', ')) as HTMLElement;
    expect(hidden.textContent).toBe(', unread, 2 mentions');
    expect(getComputedStyle(hidden).position).toBe('absolute');
  });
});
