import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';

// --- Mock hooks ---
const mockDeviceSettings = {
  audioInputDevices: [{ deviceId: 'mic-1', label: 'Test Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() }],
  audioOutputDevices: [{ deviceId: 'spk-1', label: 'Test Speaker', kind: 'audiooutput' as const, groupId: '', toJSON: vi.fn() }],
  videoInputDevices: [{ deviceId: 'cam-1', label: 'Test Camera', kind: 'videoinput' as const, groupId: '', toJSON: vi.fn() }],
  selectedAudioInputId: 'mic-1',
  selectedAudioOutputId: 'spk-1',
  selectedVideoInputId: 'cam-1',
  setSelectedAudioInput: vi.fn(),
  setSelectedAudioOutput: vi.fn(),
  setSelectedVideoInput: vi.fn(),
  isLoading: false,
  permissions: { microphone: true, camera: true },
  requestPermissions: vi.fn(),
  enumerateDevices: vi.fn(),
  getAudioConstraints: vi.fn(() => true),
  getVideoConstraints: vi.fn(() => true),
};

vi.mock('../../hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => mockDeviceSettings,
}));

let mockTestingAudio = false;
let mockAudioLevel = 0;
let mockRawAudioLevel = 0;

vi.mock('../../hooks/useDeviceTest', () => ({
  useDeviceTest: () => ({
    testingAudio: mockTestingAudio,
    testingVideo: false,
    audioLevel: mockAudioLevel,
    rawAudioLevel: mockRawAudioLevel,
    testAudioInput: vi.fn(),
    testVideoInput: vi.fn(),
    stopAudioTest: vi.fn(),
    stopVideoTest: vi.fn(),
  }),
  getDeviceLabel: (device: { label: string }) => device.label || 'Unknown',
}));

let mockInputMode = 'voice_activity';
let mockThreshold = 25;
let mockEchoCancellation = true;
let mockNoiseSuppression = true;
let mockAutoGainControl = true;
let mockVoiceIsolation = false;
let mockMicQuality = 'high';
const mockSetMicQuality = vi.fn();
const mockSetAudioProcessing = vi.fn();
const mockSetVoiceActivityThreshold = vi.fn();

vi.mock('../../hooks/useVoiceSettings', () => ({
  useVoiceSettings: () => ({
    inputMode: mockInputMode,
    pushToTalkKeyDisplay: '`',
    voiceActivityThreshold: mockThreshold,
    echoCancellation: mockEchoCancellation,
    noiseSuppression: mockNoiseSuppression,
    autoGainControl: mockAutoGainControl,
    voiceIsolation: mockVoiceIsolation,
    micQuality: mockMicQuality,
    setMicQuality: mockSetMicQuality,
    setInputMode: vi.fn(),
    setPushToTalkKey: vi.fn(),
    setVoiceActivityThreshold: mockSetVoiceActivityThreshold,
    setAudioProcessing: mockSetAudioProcessing,
  }),
  VoiceInputMode: {},
}));

import AudioVideoSettingsPanel from '../../components/Settings/AudioVideoSettingsPanel';

describe('AudioVideoSettingsPanel — threshold preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestingAudio = false;
    mockAudioLevel = 0;
    mockRawAudioLevel = 0;
    mockInputMode = 'voice_activity';
    mockThreshold = 25;
    mockEchoCancellation = true;
    mockNoiseSuppression = true;
    mockAutoGainControl = true;
    mockVoiceIsolation = false;
    mockMicQuality = 'high';
  });

  it('shows threshold marker when testing audio in voice activity mode', () => {
    mockTestingAudio = true;
    mockAudioLevel = 60;
    mockRawAudioLevel = 30;

    renderWithProviders(<AudioVideoSettingsPanel />);

    const marker = screen.getByTestId('threshold-marker');
    expect(marker).toBeInTheDocument();
  });

  it('shows "Transmitting" when raw audio is above threshold', () => {
    mockTestingAudio = true;
    mockAudioLevel = 60;
    mockRawAudioLevel = 30; // Above threshold of 25

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Transmitting')).toBeInTheDocument();
  });

  it('shows "Gated" when raw audio is below threshold', () => {
    mockTestingAudio = true;
    mockAudioLevel = 20;
    mockRawAudioLevel = 10; // Below threshold of 25

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Gated')).toBeInTheDocument();
  });

  it('does NOT show threshold marker in push_to_talk mode', () => {
    mockTestingAudio = true;
    mockAudioLevel = 60;
    mockRawAudioLevel = 30;
    mockInputMode = 'push_to_talk';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.queryByTestId('threshold-marker')).not.toBeInTheDocument();
  });

  it('shows percentage level in PTT mode instead of Transmitting/Gated', () => {
    mockTestingAudio = true;
    mockAudioLevel = 60;
    mockRawAudioLevel = 30;
    mockInputMode = 'push_to_talk';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('Transmitting')).not.toBeInTheDocument();
    expect(screen.queryByText('Gated')).not.toBeInTheDocument();
  });

  it('does NOT show threshold marker when audio test is not running', () => {
    mockTestingAudio = false;

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.queryByTestId('threshold-marker')).not.toBeInTheDocument();
  });

  it('shows helper text about the threshold marker', () => {
    mockTestingAudio = true;
    mockAudioLevel = 60;
    mockRawAudioLevel = 30;

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText(/marker shows your sensitivity threshold/i)).toBeInTheDocument();
  });

  it('renders Input Sensitivity control inside the Test Microphone section', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    const sensitivityLabel = screen.getByText('Input Sensitivity');
    const testMicLabel = screen.getByText('Test Microphone');
    // Both labels live inside the same Paper card.
    expect(sensitivityLabel.closest('.MuiPaper-root')).toBe(
      testMicLabel.closest('.MuiPaper-root')
    );
  });

  it('hides the Input Sensitivity control in push_to_talk mode', () => {
    mockInputMode = 'push_to_talk';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.queryByText('Input Sensitivity')).not.toBeInTheDocument();
  });

  it('calls setVoiceActivityThreshold when the Input Sensitivity slider moves', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    const slider = screen.getByRole('slider', { name: /input sensitivity/i });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(mockSetVoiceActivityThreshold).toHaveBeenCalled();
    expect(mockSetVoiceActivityThreshold).toHaveBeenLastCalledWith(26);
  });

  it('threshold marker on the volume meter is keyboard-interactive and calls setVoiceActivityThreshold', () => {
    mockTestingAudio = true;
    mockRawAudioLevel = 30;

    renderWithProviders(<AudioVideoSettingsPanel />);

    const thresholdSlider = screen.getByRole('slider', { name: /voice activity threshold/i });
    fireEvent.keyDown(thresholdSlider, { key: 'ArrowLeft' });

    expect(mockSetVoiceActivityThreshold).toHaveBeenCalled();
    expect(mockSetVoiceActivityThreshold).toHaveBeenLastCalledWith(24);
  });
});

describe('AudioVideoSettingsPanel — audio processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestingAudio = false;
    mockAudioLevel = 0;
    mockRawAudioLevel = 0;
    mockInputMode = 'voice_activity';
    mockThreshold = 25;
    mockEchoCancellation = true;
    mockNoiseSuppression = true;
    mockAutoGainControl = true;
    mockVoiceIsolation = false;
  });

  it('renders all 4 audio processing switches', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Echo Cancellation')).toBeInTheDocument();
    expect(screen.getByText('Noise Suppression')).toBeInTheDocument();
    expect(screen.getByText('Auto Gain Control')).toBeInTheDocument();
    expect(screen.getByText('Voice Isolation')).toBeInTheDocument();
  });

  it('renders the Audio Processing heading', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Audio Processing')).toBeInTheDocument();
  });

  it('renders the Experimental chip on Voice Isolation', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Experimental')).toBeInTheDocument();
  });

  it('shows the info note about changes taking effect on next join', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText(/changes take effect the next time you join a voice channel/i)).toBeInTheDocument();
  });

  it('renders switches with correct default states', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    const echoSwitch = screen.getByText('Echo Cancellation').closest('label')?.querySelector('input');
    const noiseSwitch = screen.getByText('Noise Suppression').closest('label')?.querySelector('input');
    const agcSwitch = screen.getByText('Auto Gain Control').closest('label')?.querySelector('input');
    const voiceIsoSwitch = screen.getByText('Voice Isolation').closest('label')?.querySelector('input');

    expect(echoSwitch).toBeChecked();
    expect(noiseSwitch).toBeChecked();
    expect(agcSwitch).toBeChecked();
    expect(voiceIsoSwitch).not.toBeChecked();
  });

  it('calls setAudioProcessing when toggling Echo Cancellation', async () => {
    const { user } = renderWithProviders(<AudioVideoSettingsPanel />);

    const echoSwitch = screen.getByText('Echo Cancellation').closest('label')?.querySelector('input');
    await user.click(echoSwitch!);

    expect(mockSetAudioProcessing).toHaveBeenCalledWith('echoCancellation', false);
  });

  it('calls setAudioProcessing when toggling Noise Suppression', async () => {
    const { user } = renderWithProviders(<AudioVideoSettingsPanel />);

    const noiseSwitch = screen.getByText('Noise Suppression').closest('label')?.querySelector('input');
    await user.click(noiseSwitch!);

    expect(mockSetAudioProcessing).toHaveBeenCalledWith('noiseSuppression', false);
  });

  it('calls setAudioProcessing when toggling Auto Gain Control', async () => {
    const { user } = renderWithProviders(<AudioVideoSettingsPanel />);

    const agcSwitch = screen.getByText('Auto Gain Control').closest('label')?.querySelector('input');
    await user.click(agcSwitch!);

    expect(mockSetAudioProcessing).toHaveBeenCalledWith('autoGainControl', false);
  });

  it('calls setAudioProcessing when enabling Voice Isolation', async () => {
    const { user } = renderWithProviders(<AudioVideoSettingsPanel />);

    const voiceIsoSwitch = screen.getByText('Voice Isolation').closest('label')?.querySelector('input');
    await user.click(voiceIsoSwitch!);

    expect(mockSetAudioProcessing).toHaveBeenCalledWith('voiceIsolation', true);
  });

  it('reflects disabled state when echoCancellation is off', () => {
    mockEchoCancellation = false;

    renderWithProviders(<AudioVideoSettingsPanel />);

    const echoSwitch = screen.getByText('Echo Cancellation').closest('label')?.querySelector('input');
    expect(echoSwitch).not.toBeChecked();
  });
});

describe('AudioVideoSettingsPanel — disconnected device indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestingAudio = false;
    mockAudioLevel = 0;
    mockRawAudioLevel = 0;
    mockInputMode = 'voice_activity';
    mockThreshold = 25;
    mockEchoCancellation = true;
    mockNoiseSuppression = true;
    mockAutoGainControl = true;
    mockVoiceIsolation = false;

    // Reset device settings to defaults
    mockDeviceSettings.audioInputDevices = [{ deviceId: 'mic-1', label: 'Test Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() }];
    mockDeviceSettings.audioOutputDevices = [{ deviceId: 'spk-1', label: 'Test Speaker', kind: 'audiooutput' as const, groupId: '', toJSON: vi.fn() }];
    mockDeviceSettings.videoInputDevices = [{ deviceId: 'cam-1', label: 'Test Camera', kind: 'videoinput' as const, groupId: '', toJSON: vi.fn() }];
    mockDeviceSettings.selectedAudioInputId = 'mic-1';
    mockDeviceSettings.selectedAudioOutputId = 'spk-1';
    mockDeviceSettings.selectedVideoInputId = 'cam-1';
  });

  it('shows disconnected indicator when saved microphone is not in device list', () => {
    mockDeviceSettings.selectedAudioInputId = 'bt-headset-123';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Previously selected device (disconnected)')).toBeInTheDocument();
  });

  it('shows disconnected indicator when saved speaker is not in device list', () => {
    mockDeviceSettings.selectedAudioOutputId = 'bt-speaker-456';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Previously selected device (disconnected)')).toBeInTheDocument();
  });

  it('shows disconnected indicator when saved camera is not in device list', () => {
    mockDeviceSettings.selectedVideoInputId = 'usb-cam-789';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByText('Previously selected device (disconnected)')).toBeInTheDocument();
  });

  it('does NOT show disconnected indicator when selected device is "default"', () => {
    mockDeviceSettings.selectedAudioInputId = 'default';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.queryByText('Previously selected device (disconnected)')).not.toBeInTheDocument();
  });

  it('does NOT show disconnected indicator when device is present in the list', () => {
    // selectedAudioInputId = 'mic-1' is in audioInputDevices — no indicator
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.queryByText('Previously selected device (disconnected)')).not.toBeInTheDocument();
  });
});

describe('AudioVideoSettingsPanel — device lists and selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestingAudio = false;
    mockAudioLevel = 0;
    mockRawAudioLevel = 0;
    mockInputMode = 'voice_activity';
    mockThreshold = 25;
    mockEchoCancellation = true;
    mockNoiseSuppression = true;
    mockAutoGainControl = true;
    mockVoiceIsolation = false;

    // Reset device settings to defaults (other suites mutate these)
    mockDeviceSettings.audioInputDevices = [{ deviceId: 'mic-1', label: 'Test Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() }];
    mockDeviceSettings.audioOutputDevices = [{ deviceId: 'spk-1', label: 'Test Speaker', kind: 'audiooutput' as const, groupId: '', toJSON: vi.fn() }];
    mockDeviceSettings.videoInputDevices = [{ deviceId: 'cam-1', label: 'Test Camera', kind: 'videoinput' as const, groupId: '', toJSON: vi.fn() }];
    mockDeviceSettings.selectedAudioInputId = 'mic-1';
    mockDeviceSettings.selectedAudioOutputId = 'spk-1';
    mockDeviceSettings.selectedVideoInputId = 'cam-1';
    mockDeviceSettings.permissions = { microphone: true, camera: true };
  });

  // The selects' InputLabels are not programmatically associated (no labelId),
  // so the comboboxes have no accessible name. Query by DOM order instead:
  // [0] Microphone, [1] Speakers, [2] Camera.
  const getSelects = () => {
    // Skip the labelled "Microphone quality" select; the device selects are unnamed.
    const selects = screen
      .getAllByRole('combobox')
      .filter((el) => el.getAttribute('aria-labelledby')?.includes('mic-quality-label') !== true);
    return { micSelect: selects[0], speakerSelect: selects[1], cameraSelect: selects[2] };
  };

  it('renders selected device labels from useDeviceSettings', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    const { micSelect, speakerSelect, cameraSelect } = getSelects();
    expect(micSelect).toHaveTextContent('Test Mic');
    expect(speakerSelect).toHaveTextContent('Test Speaker');
    expect(cameraSelect).toHaveTextContent('Test Camera');
  });

  it('lists all available devices when the microphone select is opened', async () => {
    mockDeviceSettings.audioInputDevices = [
      { deviceId: 'mic-1', label: 'Test Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() },
      { deviceId: 'mic-2', label: 'Second Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() },
    ];

    const { user } = renderWithProviders(<AudioVideoSettingsPanel />);

    await user.click(getSelects().micSelect);

    expect(await screen.findByRole('option', { name: 'Test Mic' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Second Mic' })).toBeInTheDocument();
  });

  it('selecting a microphone persists the selection and notifies onDeviceChange', async () => {
    mockDeviceSettings.audioInputDevices = [
      { deviceId: 'mic-1', label: 'Test Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() },
      { deviceId: 'mic-2', label: 'Second Mic', kind: 'audioinput' as const, groupId: '', toJSON: vi.fn() },
    ];
    const onDeviceChange = vi.fn();

    const { user } = renderWithProviders(<AudioVideoSettingsPanel onDeviceChange={onDeviceChange} />);

    await user.click(getSelects().micSelect);
    await user.click(await screen.findByRole('option', { name: 'Second Mic' }));

    expect(mockDeviceSettings.setSelectedAudioInput).toHaveBeenCalledWith('mic-2');
    expect(onDeviceChange).toHaveBeenCalledWith('audio', 'mic-2');
  });

  it('selecting a speaker persists the selection and notifies onDeviceChange', async () => {
    mockDeviceSettings.audioOutputDevices = [
      { deviceId: 'spk-1', label: 'Test Speaker', kind: 'audiooutput' as const, groupId: '', toJSON: vi.fn() },
      { deviceId: 'spk-2', label: 'Second Speaker', kind: 'audiooutput' as const, groupId: '', toJSON: vi.fn() },
    ];
    const onDeviceChange = vi.fn();

    const { user } = renderWithProviders(<AudioVideoSettingsPanel onDeviceChange={onDeviceChange} />);

    await user.click(getSelects().speakerSelect);
    await user.click(await screen.findByRole('option', { name: 'Second Speaker' }));

    expect(mockDeviceSettings.setSelectedAudioOutput).toHaveBeenCalledWith('spk-2');
    expect(onDeviceChange).toHaveBeenCalledWith('audioOutput', 'spk-2');
  });

  it('selecting a camera persists the selection and notifies onDeviceChange', async () => {
    mockDeviceSettings.videoInputDevices = [
      { deviceId: 'cam-1', label: 'Test Camera', kind: 'videoinput' as const, groupId: '', toJSON: vi.fn() },
      { deviceId: 'cam-2', label: 'Second Camera', kind: 'videoinput' as const, groupId: '', toJSON: vi.fn() },
    ];
    const onDeviceChange = vi.fn();

    const { user } = renderWithProviders(<AudioVideoSettingsPanel onDeviceChange={onDeviceChange} />);

    await user.click(getSelects().cameraSelect);
    await user.click(await screen.findByRole('option', { name: 'Second Camera' }));

    expect(mockDeviceSettings.setSelectedVideoInput).toHaveBeenCalledWith('cam-2');
    expect(onDeviceChange).toHaveBeenCalledWith('video', 'cam-2');
  });

  // Actual empty-list behavior: the select disables itself, so the
  // "No devices found" MenuItem fallback is unreachable in the closed UI.
  it('disables the microphone select when the device list is empty', () => {
    mockDeviceSettings.audioInputDevices = [];
    mockDeviceSettings.selectedAudioInputId = '';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(getSelects().micSelect).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables the speaker select when the device list is empty', () => {
    mockDeviceSettings.audioOutputDevices = [];
    mockDeviceSettings.selectedAudioOutputId = '';

    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(getSelects().speakerSelect).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('AudioVideoSettingsPanel — microphone quality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMicQuality = 'high';
  });

  it('shows High (96 kbps) by default with its description and the apply note', () => {
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByRole('combobox', { name: 'Microphone quality' })).toHaveTextContent('High (96 kbps)');
    expect(screen.getByText(/Transparent voice\. Recommended\./)).toBeInTheDocument();
    expect(screen.getByText(/Applies the next time you join voice\./)).toBeInTheDocument();
  });

  it('calls setMicQuality when Music (128 kbps) is chosen', async () => {
    const { user } = renderWithProviders(<AudioVideoSettingsPanel />);

    await user.click(screen.getByRole('combobox', { name: 'Microphone quality' }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    await user.click(within(listbox).getByRole('option', { name: 'Music (128 kbps)' }));

    expect(mockSetMicQuality).toHaveBeenCalledWith('music');
  });

  it('shows the stored option and its description', () => {
    mockMicQuality = 'music';
    renderWithProviders(<AudioVideoSettingsPanel />);

    expect(screen.getByRole('combobox', { name: 'Microphone quality' })).toHaveTextContent('Music (128 kbps)');
    expect(screen.getByText(/never gates silence/)).toBeInTheDocument();
  });
});
