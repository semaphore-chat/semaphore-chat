import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { visuallyHidden } from '../theme/a11y';
import { focusRing } from '../theme/states';
import { transientProps } from '../theme/transientProps';

export interface TableColumn {
  id: string;
  header: string;
  align?: 'start' | 'end';
}

export interface TableRow {
  id: string;
  cells: Record<string, ReactNode>;
}

export interface TableProps {
  /** Names the table (a visually hidden caption). */
  label: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** Shown in one full-width cell when there are no rows. */
  empty?: string;
}

/** The box that scrolls sideways when the table is too wide; focusable so a keyboard can scroll it. */
const Scroller = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    width: '100%',
    overflowX: 'auto',
    '&:focus-visible': focusRing(palette),
  };
});

const Root = styled('table')({
  width: '100%',
  borderCollapse: 'collapse',
  borderSpacing: 0,
});

const Caption = styled('caption')({ ...visuallyHidden });

const Cell = styled('td', { shouldForwardProp: transientProps })<{ $align: 'start' | 'end' }>(
  ({ theme, $align }) => {
    const { palette } = kitTheme(theme);
    const type = tokens.text.body;
    return {
      padding: `${tokens.space.md}px`,
      borderBottom: `${tokens.border.hairline}px solid ${palette.hairline}`,
      textAlign: $align,
      verticalAlign: 'middle',
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: type.weight,
      color: palette.text,
    };
  },
);

const HeaderCell = styled('th', { shouldForwardProp: transientProps })<{ $align: 'start' | 'end' }>(
  ({ theme, $align }) => {
    const { palette } = kitTheme(theme);
    const type = tokens.text.meta;
    return {
      padding: `${tokens.space.md}px`,
      borderBottom: `${tokens.border.hairline}px solid ${palette.hairline}`,
      textAlign: $align,
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: tokens.text.bodyStrong.weight,
      color: palette.textSecondary,
    };
  },
);

const EmptyCell = styled('td')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.body;
  return {
    padding: `${tokens.space.xl}px ${tokens.space.md}px`,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    color: palette.textSecondary,
  };
});

/**
 * A plain data table: real table semantics, hairline row dividers, no zebra
 * and no outer border. Cells take text or kit components. Too wide for its
 * box, it scrolls sideways inside the box rather than the page.
 */
export function Table({ label, columns, rows, empty }: TableProps): JSX.Element {
  return (
    <Scroller role="region" aria-label={label} tabIndex={0}>
      <Root>
        <Caption>{label}</Caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell key={column.id} scope="col" $align={column.align ?? 'start'}>
                {column.header}
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr>
              <EmptyCell colSpan={columns.length}>{empty}</EmptyCell>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <Cell key={column.id} $align={column.align ?? 'start'}>
                    {row.cells[column.id]}
                  </Cell>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </Root>
    </Scroller>
  );
}
