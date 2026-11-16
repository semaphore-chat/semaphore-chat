/**
 * voiceChannelMemory: the voice channel ids the new shell has seen, which keep a voice channel's route on the old
 * shell's call view (chooseShell). A new snapshot only when something changed, so the shell choice re-renders rarely.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  forgetVoiceChannels,
  knownVoiceChannels,
  noteVoiceChannels,
  useKnownVoiceChannels,
} from '../../shell/voiceChannelMemory';

beforeEach(() => forgetVoiceChannels());

describe('voiceChannelMemory', () => {
  it('notes ids and keeps the same snapshot when nothing new is noted', () => {
    noteVoiceChannels(['v-1', 'v-2']);
    const first = knownVoiceChannels();
    expect([...first]).toEqual(['v-1', 'v-2']);
    noteVoiceChannels(['v-2', 'v-1']);
    noteVoiceChannels([]);
    expect(knownVoiceChannels()).toBe(first);
    noteVoiceChannels(['v-3', 'v-3']);
    expect(knownVoiceChannels()).not.toBe(first);
    expect([...knownVoiceChannels()]).toEqual(['v-1', 'v-2', 'v-3']);
    // The old snapshot is never changed in place.
    expect(first.has('v-3')).toBe(false);
  });

  it('re-renders a reader when an id is added or the memory is forgotten, not on a repeat', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useKnownVoiceChannels();
    });
    expect(result.current.size).toBe(0);
    act(() => noteVoiceChannels(['v-1']));
    expect(result.current.has('v-1')).toBe(true);
    const after = renders;
    act(() => noteVoiceChannels(['v-1']));
    expect(renders).toBe(after);
    act(() => forgetVoiceChannels());
    expect(result.current.size).toBe(0);
  });
});
