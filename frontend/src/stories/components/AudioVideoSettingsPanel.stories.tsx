import { useEffect, useState, type ReactNode } from 'react';
import AudioVideoSettingsPanel from '../../components/Settings/AudioVideoSettingsPanel';
import { VOICE_SETTINGS_KEY } from '../../hooks/useVoiceSettings';
import type { MicQuality } from '../../utils/voiceQuality';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/**
 * Seeds the stored voice settings before the panel mounts (useVoiceSettings
 * reads them once, in its initial state), and puts the old value back when
 * the story unmounts so other stories see the defaults.
 */
const WithStoredVoiceSettings = ({ stored, children }: { stored: object | null; children: ReactNode }) => {
  const [saved] = useState(() => {
    const previous = localStorage.getItem(VOICE_SETTINGS_KEY);
    if (stored) localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(stored));
    else localStorage.removeItem(VOICE_SETTINGS_KEY);
    return previous;
  });
  useEffect(
    () => () => {
      if (saved === null) localStorage.removeItem(VOICE_SETTINGS_KEY);
      else localStorage.setItem(VOICE_SETTINGS_KEY, saved);
    },
    [saved],
  );
  return <>{children}</>;
};

const withMicQuality = (micQuality: MicQuality | undefined) =>
  defineComponent(bigCommunityScenario, () => (
    <WithStoredVoiceSettings stored={micQuality ? { micQuality } : null}>
      <AudioVideoSettingsPanel showHeader={false} />
    </WithStoredVoiceSettings>
  ));

/** Defaults: "Microphone quality" shows High (96 kbps). */
export const DefaultMicQuality = withMicQuality(undefined);
/** Stored micQuality "music": Music (128 kbps) preselected. */
export const MusicMicQuality = withMicQuality('music');
/** Stored micQuality "standard": Standard (48 kbps) preselected. */
export const StandardMicQuality = withMicQuality('standard');
