import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Pill, Table, type TableColumn, type TableRow } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const columns: TableColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'role', header: 'Role' },
  { id: 'joined', header: 'Joined', align: 'end' },
];
const rows: TableRow[] = [
  { id: '1', cells: { name: 'aiko', role: <Pill tone="accent">Admin</Pill>, joined: '2026-01-02' } },
  { id: '2', cells: { name: 'gracie', role: 'Member', joined: '2026-02-03' } },
];

describe('Table', () => {
  it('is a table named by its label, with column headers', () => {
    renderWithKit(<Table label="Members" columns={columns} rows={rows} />);
    expect(screen.getByRole('table', { name: 'Members' })).toBeInTheDocument();
    for (const header of ['Name', 'Role', 'Joined']) {
      expect(screen.getByRole('columnheader', { name: header })).toHaveAttribute('scope', 'col');
    }
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('renders a kit component passed as a cell', () => {
    renderWithKit(<Table label="Members" columns={columns} rows={rows} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /aiko/ });
    expect(within(row).getByRole('cell', { name: 'aiko' })).toBeInTheDocument();
  });

  it('end alignment applies to the header and its cells', () => {
    renderWithKit(<Table label="Members" columns={columns} rows={rows} />);
    expect(getComputedStyle(screen.getByRole('columnheader', { name: 'Joined' })).textAlign).toBe('end');
    expect(getComputedStyle(screen.getByRole('cell', { name: '2026-01-02' })).textAlign).toBe('end');
    expect(getComputedStyle(screen.getByRole('cell', { name: 'aiko' })).textAlign).not.toBe('end');
  });

  it('shows the empty message in one cell spanning every column', () => {
    renderWithKit(<Table label="Members" columns={columns} rows={[]} empty="Nobody here yet" />);
    const cell = screen.getByRole('cell', { name: 'Nobody here yet' });
    expect(cell).toHaveAttribute('colspan', String(columns.length));
  });

  it('shows no empty message when there are rows', () => {
    renderWithKit(<Table label="Members" columns={columns} rows={rows} empty="Nobody here yet" />);
    expect(screen.queryByText('Nobody here yet')).toBeNull();
  });

  it('renders a missing cell as empty', () => {
    renderWithKit(
      <Table label="M" columns={columns} rows={[{ id: 'x', cells: { name: 'only' } }]} />,
    );
    expect(screen.getAllByRole('cell')).toHaveLength(3);
  });
});
