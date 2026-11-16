/**
 * The classic soundboard button no longer warms the soundboard track up: useSoundboardWarmup
 * (VoiceSessionEffects, above both shells) owns it. A button that mounts mid-call (a layout, breakpoint
 * or shell change) must publish nothing, or every peer gets a new audio element.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { RoomContext } from '../../contexts/RoomContextDef';
import { SoundboardButton } from '../../components/Voice/SoundboardButton';

const soundboard = vi.hoisted(() => ({ warmup: vi.fn(() => Promise.resolve()) }));
vi.mock('../../features/voice/soundboardPlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/voice/soundboardPlayer')>();
  return { ...actual, soundboardPlayer: { ...actual.soundboardPlayer, warmup: soundboard.warmup } };
});

describe('SoundboardButton', () => {
  it('mounting it mid-call, with a Room, publishes nothing', () => {
    const room = { localParticipant: { trackPublications: new Map() } } as never;
    renderWithProviders(
      <RoomContext value={{ room, setRoom: vi.fn(), getRoom: () => room }}>
        <SoundboardButton communityId="c-1" onPlay={vi.fn()} />
      </RoomContext>,
    );

    expect(screen.getByRole('button', { name: /soundboard/i })).toBeInTheDocument();
    expect(soundboard.warmup).not.toHaveBeenCalled();
  });
});
