import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { AvatarStack } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const PEOPLE = [
  { name: 'aiko', colour: '#FF8FB8' },
  { name: 'dropbear', colour: '#5FD49A' },
  { name: 'gracie', colour: '#FFA366' },
  { name: 'kwam3', colour: '#6FB1F5' },
  { name: 'pri', colour: '#C792F0' },
];

describe('AvatarStack', () => {
  it('shows the first three people and a +N for the rest', () => {
    renderWithKit(<AvatarStack people={PEOPLE} max={3} />);
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('DR')).toBeInTheDocument();
    expect(screen.getByText('GR')).toBeInTheDocument();
    expect(screen.queryByText('K3')).toBeNull();
    expect(screen.queryByText('PR')).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('defaults to three', () => {
    renderWithKit(<AvatarStack people={PEOPLE} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('is one group named by the first names and the rest', () => {
    renderWithKit(<AvatarStack people={PEOPLE} max={3} />);
    expect(screen.getByRole('group', { name: 'aiko, dropbear, gracie and 2 more' })).toBeInTheDocument();
    // The avatars inside add no names of their own.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('uses the label when given', () => {
    renderWithKit(<AvatarStack people={PEOPLE} label="In the voice room" />);
    expect(screen.getByRole('group', { name: 'In the voice room' })).toBeInTheDocument();
  });

  it('shows no +N when everyone fits', () => {
    renderWithKit(<AvatarStack people={PEOPLE.slice(0, 2)} />);
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.getByRole('group', { name: 'aiko and dropbear' })).toBeInTheDocument();
  });

  it('names one person and renders nothing for nobody', () => {
    const { container, rerender } = renderWithKit(<AvatarStack people={PEOPLE.slice(0, 1)} />);
    expect(screen.getByRole('group', { name: 'aiko' })).toBeInTheDocument();
    rerender(<AvatarStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('copes with a max of 0 or below, or NaN', () => {
    const { rerender } = renderWithKit(<AvatarStack people={PEOPLE} max={0} />);
    expect(screen.getByText('+5')).toBeInTheDocument();
    rerender(<AvatarStack people={PEOPLE} max={-2} />);
    expect(screen.getByText('+5')).toBeInTheDocument();
    rerender(<AvatarStack people={PEOPLE} max={Number.NaN} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
