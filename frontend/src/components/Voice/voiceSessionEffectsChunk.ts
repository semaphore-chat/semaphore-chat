/**
 * The loader of the lazy VoiceSessionEffects chunk, used by VoiceSessionLayer.
 * An object (not a bare import()) so tests can make the load fail.
 */
export const voiceSessionEffectsChunk = {
  load: () => import("./VoiceSessionEffects"),
};
