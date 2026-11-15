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
    expect(screen.getByRole('img', { name: 'aiko, dropbear, gracie and 2 more' })).toBeInTheDocument();
    // The avatars inside add no names of their own.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('uses the label when given', () => {
    renderWithKit(<AvatarStack people={PEOPLE} label="In the voice room" />);
    expect(screen.getByRole('img', { name: 'In the voice room' })).toBeInTheDocument();
  });

  it('shows no +N when everyone fits', () => {
    renderWithKit(<AvatarStack people={PEOPLE.slice(0, 2)} />);
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.getByRole('img', { name: 'aiko and dropbear' })).toBeInTheDocument();
  });

  it('names one person and renders nothing for nobody', () => {
    const { container, rerender } = renderWithKit(<AvatarStack people={PEOPLE.slice(0, 1)} />);
    expect(screen.getByRole('img', { name: 'aiko' })).toBeInTheDocument();
    rerender(<AvatarStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('joins names with "and" explicitly, so a comma inside a name stays inside it', () => {
    renderWithKit(<AvatarStack people={[{ name: 'Smith, John' }, { name: 'bob' }]} />);
    expect(screen.getByRole('img', { name: 'Smith, John and bob' })).toBeInTheDocument();
  });

  it('names a blank person as the avatar does', () => {
    renderWithKit(<AvatarStack people={[{ name: '' }, { name: 'bob' }, { name: '  ' }]} />);
    expect(screen.getByRole('img', { name: 'Unknown user, bob and Unknown user' })).toBeInTheDocument();
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

describe('AvatarStack speaking (K6)', () => {
  const crew = [
    { name: 'pri' },
    { name: 'dropbear', speaking: true },
    { name: 'aiko' },
  ];

  it('rings the speaking avatar only', () => {
    const { container } = renderWithKit(<AvatarStack people={crew} />);
    const rings = container.querySelectorAll('[data-kit-speaking]');
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveTextContent('DR');
  });

  it('says who is talking in the name', () => {
    renderWithKit(<AvatarStack people={crew} />);
    expect(screen.getByRole('img', { name: 'pri, dropbear and aiko, dropbear is talking' })).toBeInTheDocument();
  });

  it('two or more speakers: "A and B are talking"; none: the name is unchanged', () => {
    const two = renderWithKit(
      <AvatarStack people={[{ name: 'pri', speaking: true }, { name: 'dropbear', speaking: true }, { name: 'aiko' }]} />,
    );
    expect(screen.getByRole('img', { name: 'pri, dropbear and aiko, pri and dropbear are talking' })).toBeInTheDocument();
    two.unmount();
    const none = renderWithKit(<AvatarStack people={[{ name: 'pri', speaking: false }]} />);
    expect(screen.getByRole('img', { name: 'pri' })).toBeInTheDocument();
    expect(none.container.querySelector('[data-kit-speaking]')).toBeNull();
  });

  it('a speaker behind the "+N" is still in the name', () => {
    renderWithKit(<AvatarStack max={1} people={[{ name: 'pri' }, { name: 'dropbear', speaking: true }]} />);
    expect(screen.getByRole('img', { name: 'pri and 1 more, dropbear is talking' })).toBeInTheDocument();
  });

  it('an explicit label still wins', () => {
    renderWithKit(<AvatarStack label="In Squad Up" people={crew} />);
    expect(screen.getByRole('img', { name: 'In Squad Up' })).toBeInTheDocument();
  });
});
