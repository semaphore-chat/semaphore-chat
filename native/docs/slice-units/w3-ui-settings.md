# W3-ui-settings: the settings shell and its tabs

Piece B of the wave 3 UI (`native/docs/parity-plan.md`, row `W3-ui-settings`). Built from the W3
freeze commit dd233a99. Owns `native/crates/semaphore-ui/src/settings/**` and
`native/rigs/shot/scripts/w3-settings.steps` only. Pieces A (`profile/**`, `home/**`) and C
(`auth/**`) are built by another agent at the same time; nothing here touches them, `theme/`,
`kit/` or `notifications/`. Components with stories and unit tests only: wiring into the app is
W3-app.

Behaviour reference: `frontend/src/pages/SettingsPage.tsx` and `frontend/src/components/Settings/`
(`AudioVideoSettingsPanel.tsx`, `SessionsSettings.tsx`, `NotificationSettings.tsx`), and the voice
settings in `frontend/src/hooks/useVoiceSettings.ts`. Match what they do; never copy GPL code from
elsewhere.

## Shared rules

- Every component is a GPUI entity that takes data through `set_*` and emits one `*Event` enum; the
  owner calls core (as `friends/`, `dms/`, `notifications/`). Times go through `PanelClock`.
- States for each part that loads: loading, empty, failed with Retry, validation errors, busy, long
  content, phone width (390 px).
- Stories go in `settings/stories.rs` behind `#[cfg(feature = "stories")]`; `settings::stories()` is
  already in `stories::all()`. Tests in `settings/tests.rs` (and `key_capture` tests), with the
  window rig the other modules use.

## Where it lives

Route `Settings { tab }` in the main area (W3-app adds the route). The "Voice settings" menu item
opens it at Voice & video, replacing today's dialog in `semaphore-app/src/root.rs`.

## Components, inputs, events (exact names: W3-app codes against them)

- **`SettingsScreen`** (the shell). Creates and exposes its tabs: `notifications()` (the existing
  `crate::notifications::NotificationSettingsSection`, created with its own `new(window, cx)`,
  unchanged, keeps its Save button), `voice()`, `appearance()`, `sessions()`, `desktop()`, each an
  `Entity<_>`. In: `set_tab(SettingsTab)` with `SettingsTab { Notifications, VoiceVideo,
  Appearance, Sessions, DesktopApp }`. Events `SettingsShellEvent::{ TabChanged(SettingsTab), Close }`.
  Layout: nav column (labels "Notifications", "Voice & video", "Appearance", "Sessions", "Desktop
  app") plus content on desktop; at phone width a list you tap into, with a back button.
- **`VoiceVideoSettings`**. In: `set_state(VoiceVideoState)`, `set_devices(DeviceLists)`,
  `set_mic_level(Option<f32>)` (0..1 while a mic test runs; `None` = not testing).
  - `VoiceVideoState` (UI-owned value type): `processing: Processing { echo_cancellation,
    noise_suppression, auto_gain }`, `mic_quality: MicQuality { Standard, High, Music }`,
    `input_mode: InputMode { VoiceActivity { threshold: u8 /* 0..=100 */ }, PushToTalk }`,
    `ptt_key: Option<String>`, `input_device`, `output_device`, `camera: Option<String>` (`None` =
    system default), `share: ShareQuality { resolution: semaphore_core::model::ShareResolution,
    fps: u32 /* 15, 30, 60 */, audio: bool }`.
  - `DeviceLists { state: LoadState, inputs, outputs, cameras: Vec<DeviceOption> }`,
    `DeviceOption { id, name, is_default }`.
  - Events `VoiceSettingsEvent::{ Changed(VoiceVideoState), StartMicTest, StopMicTest,
    PlayTestSound, RefreshDevices }`. Changes apply at once (no Save), as the web.
  - Sections: Input mode (voice activity vs push to talk, key capture under PTT); Processing
    switches (echo cancellation, noise suppression, auto gain; no "Voice isolation"); Microphone
    quality select; Microphone and Speakers selects; Test microphone (Test/Stop button, level meter,
    in voice-activity mode the threshold slider and "Transmitting"/"Gated" label, as the web);
    Speakers "Play test sound"; Camera select (no camera preview); Screen share size, frame rate,
    system audio switch (today's dialog's choices; reuse the labels in `semaphore-app/src/settings.rs`
    `ShareSize::label` by mirroring them, not by depending on the app crate).
- **`AppearanceSettings`**. In: `set_view(AppearanceView)`. Events `AppearanceEvent::{
  Update(AppearancePatch), Retry }`. Dark/light switch (no "follow the system"), 12 accent swatches,
  3 intensities, and a live preview: a small mock drawn with `crate::theme::Sem::new(
  theme_choice(appearance))`. `pub fn theme_choice(Appearance) -> ThemeChoice` lives in
  `settings/`. Core shows a change at once, so each pick emits `Update` immediately.
- **`SessionsSettings`**. In: `set_view(SessionsView)`, `set_clock(PanelClock)`,
  `set_notice(Option<(Severity, String)>)` (e.g. "Signed out 3 other devices" from
  `revoke_other_sessions`'s count, or a failure). Events `SessionsEvent::{ Revoke { session_id },
  RevokeOthers, Retry }`. Rows: device name (or "Unknown device"), IP, last used relative to the
  clock, created/expires; the current one has a "Current" chip and no revoke; a `busy` row shows a
  spinner; "Sign out all other devices" confirms first and shows busy from `revoking_others`; hidden
  when only the current session exists.
- **`DesktopAppSettings`**. In: `set_state(DesktopAppState)` with `DesktopAppState { close_to_tray:
  bool, links: LinkHandler { Registered, PackageOwned, NotRegistered, Unknown }, link_preview_images:
  bool, server_url: String, server_name: Option<String>, app_version: String, server_version:
  Option<String> }`. Events `DesktopAppEvent::{ SetCloseToTray(bool), RegisterLinkHandler,
  SetLinkPreviewImages(bool), ChangeServer }`. Link handling is a status line plus a "Make
  Semaphore open semaphore:// links" button (hidden for `PackageOwned`/`Registered`). The link
  preview images switch (off by default) has a line saying the images load from third-party sites.
  No start-up behaviour.

## State ownership (what the UI needs from each)

- Server state through core: notifications (`NotificationSettingsView`), appearance
  (`AppearanceView`, optimistic), sessions (`SessionsView`; core re-reads when stale).
- Local settings (`semaphore-app/src/settings.rs`): processing switches, PTT on/off and key,
  input/output device, screen-share quality, close to tray, link preview images. Missing there, for
  W3-app to add: input mode with the voice-activity threshold, mic quality, camera device.
- Media engine (`semaphore-media-livekit`): device lists (`devices()`, `cameras()`), applying
  (`set_processing`, `set_ptt_mode`, `set_mic_preset`, `select_*`). Missing: a mic test level tap and
  VAD gating by threshold (W4-media). The UI only reacts to `set_mic_level`.

## Push-to-talk key capture (`settings/key_capture.rs`)

- "Change key" enters `Capturing`: focuses its own handle and shows "Press a key…". Its
  `on_key_down` stops propagation so app keybindings don't fire while capturing.
- `pub fn ptt_key_from(&Keystroke) -> Capture { Key(String), Cancel, Ignore }`: Escape cancels;
  modifier-only is ignored; any other key (Tab included) records its GPUI key name without
  modifiers (`"f13"`, `"space"`, `` "`" ``), as the web records `event.code` only. Losing focus
  cancels.
- `pub fn ptt_key_label(&str) -> String` (`"space"` → "Space", `"f13"` → "F13", `` "`" `` → "`").
  Stored values are lowercased on read so today's `"F13"` works. W3-app's PTT listener must use the
  same names.
- Tests: pure tests on parsed keystrokes (`f13`, `shift-a` → `a`, `escape` → Cancel); window
  tests: click, `simulate_keystrokes("f13")` emits `Changed` with `ptt_key == Some("f13")` and goes
  back to idle; Escape and blur emit nothing. Shot steps: `click`, `press f13`, `shot`.

## Stories (shot 1280×800 dark and 390×844 light in `w3-settings.steps`)

Shell on each tab and the phone list; voice: voice activity with the meter (transmitting and
gated), PTT capturing, PTT with a key set, devices loading, no devices, long device names;
appearance: each mode, each intensity, loading, failed; sessions: loading, failed, only current,
many (long device names), a row busy, revoking others, notice shown; desktop app: links registered,
not registered, package owned, unknown.

## Tests

Event emitted for each control (switch, select, radio, slider, buttons), `theme_choice` for every
`Appearance` field, session dates against a fixed `PanelClock`, the current session's missing revoke
button, the revoke-others confirm, key capture as above, the shell's tab switching and phone back.

## Proof

`native/scripts/in-image.sh` for cargo; `RESULT_SCHEMA_HOST=$PWD/scripts/native-baseline/result.schema.json
native/scripts/verify.sh` from the host (then `git checkout -- native/results/phase0/native-shell.json`);
the shots rendered and looked at for clipping, overflow and contrast.
