# Native client parity plan

Goal: the native client (`native/`) does everything the web/Electron client does. Nothing is cut.
Built from the code on `spike/native-gpui` at `3bbd528a` (web client, Electron main and preload, docs-site) and the
native crates, `docs/slice-app.md` and `docs/slice-units/README.md`. "Native" below means what the
app actually does, not what core could do: a core command with no UI counts as partial.

Paths: web paths are relative to `frontend/src/` unless they start with `electron/`, `backend/` or
`docs-site/`. Native paths are relative to `native/crates/`.

## 1. Feature inventory

States: **done**, **partial** (what's missing), **not started**, **unknown** (not determined), **n/a**
(web-only, with no desktop equivalent to build).

### Auth and onboarding

| Feature | Web client | Native |
|---|---|---|
| Server URL entry and probe (connection wizard) | `components/Electron/ConnectionWizard.tsx` | done (`Core::probe_server`, `ui/src/auth`) |
| Password sign-in | `pages/LoginPage.tsx` | done |
| Session restore at start, expired/unreachable handling | `utils/tokenService.ts`, `components/SessionUnavailable.tsx` | done (`restore_session`, Try again / session expired) |
| Sign out | `components/Desktop/RailUserMenu.tsx`, `hooks/useLogout.ts` | done (account menu) |
| Sign in with browser (PKCE, loopback) | `electron/browser-login.ts`, `components/Electron/BrowserLoginPanel.tsx`, `pages/DesktopLoginPage.tsx`, `utils/pkce.ts`, `docs-site/docs/installation/desktop-browser-sign-in.md` | not started (needs the client-type backend, see section 4) |
| Registration (with invite code) | `pages/RegisterPage.tsx` | not started (button opens the web app) |
| Forgot / reset password | `pages/ForgotPasswordPage.tsx`, `pages/ResetPasswordPage.tsx` | not started (button opens the web app) |
| First-run instance setup wizard | `pages/OnboardingPage.tsx`, `components/Onboarding/` | not started |
| Join by invite link | `pages/JoinInvitePage.tsx` | partial: `/join/:inviteCode` parses to `Route::Invite` (`ui/src/nav`); no invite preview or join command |
| Home: summary, zero-community gate, next step, invite card | `pages/HomePage.tsx`, `components/Home/`, `hooks/useHomeSummary.ts` | partial: a "Pick a community" placeholder |

### Communities and channels

| Feature | Web client | Native |
|---|---|---|
| Community rail with unread and mention counts | `components/CommunityList/` | done |
| Create community | `pages/CreateCommunityPage.tsx`, `hooks/useCommunityForm.ts` | not started |
| Channel list, collapsible categories, unread/mention badges | `components/Channel/ChannelCategoryList.tsx`, `ChannelList.tsx`, `ChannelRow.tsx` | done |
| Voice channel rows with who's in them | `components/Voice/VoiceChannelUserList.tsx` | done (`ChannelRow.voice_users`) |
| Private channels shown to members only | server-side; `ChannelRow.tsx` | done (server list; `is_private`) |
| Per-channel permissions in the composer (read-only, slowmode, timeout) | `hooks/useChannelPermissions.ts`, `hooks/useComposerAvailability.ts` | done |
| Member list: hoisted roles, online/offline | `components/Message/MemberList*.tsx` | done (with truncated flag) |
| Live structural updates (channels, roles, community, kicks/bans) | `socket-hub/` | done (core `events.rs` invalidates on every listed event) |
| Per-channel notification level menu | `components/Channel/ChannelNotificationMenu.tsx` | not started |
| Docked side panel (threads, pins, search) | `components/Channel/DockedSidePanel.tsx` | not started |

### Messaging

| Feature | Web client | Native |
|---|---|---|
| Message list: virtualised, older/newer pages, jump to present, day separators, grouping | `components/Message/VirtualMessageList.tsx`, `utils/messageGrouping.ts` | done |
| Send with nonce, optimistic row, typed ack, retry/discard failed | `hooks/useOptimisticSendMessage.ts`, `components/Message/OptimisticMessageActions.tsx` | done |
| Markdown display (bold, italic, strike, inline code, code blocks, links) | `components/Message/MessageSpan.tsx` | done (`TextStyle`, `SegKind`); other syntaxes unknown |
| Composer formatting keys (Ctrl+B / Ctrl+I) | `utils/richTextShortcuts.ts` | done (composer tests) |
| Composer drafts per conversation | `hooks/useComposerDraft.ts` | done in memory (`DraftStore`); persistence across restarts unknown |
| Mentions: @user, @here/@everyone, alias groups, #channel autocomplete and rendering | `components/Message/MentionDropdown.tsx`, `hooks/useMentionAutocomplete.ts`, `utils/mentionParser.ts` | done |
| Replies: quote display and jump to the original | `components/Message/QuotePreview.tsx`, `hooks/useJumpToMessage.ts` | done |
| Replies: start a reply from a message | `components/Message/ReplyComposerBanner.tsx`, `messageActions.ts` | partial: composer has `set_reply`; no list action triggers it |
| Threads: pane, replies, thread composer, reply badge, subscribe | `components/Thread/`, `hooks/useThreadReplies.ts`, `hooks/useThreadSubscription.ts` | partial: core opens `Conversation::Thread` and ingests `newThreadReply`/count events; `OpenThread` only logs; no pane, no subscription |
| Reactions: toggle an existing one | `components/Message/MessageReactions.tsx` | done (`toggle_reaction`) |
| Reactions: add any emoji, who-reacted tooltip | `components/Message/ReactionTooltip.tsx`, `EmojiPicker.tsx` | not started |
| Emoji picker (unicode and custom) | `components/Message/EmojiPicker.tsx`, `emojiData.ts`, `utils/emojiGridNavigation.ts` | not started (composer has an open/close hook only) |
| GIF picker and GIF embeds | `components/Message/GifPicker.tsx`, `GifEmbed.tsx`, `backend/src/gifs` | not started |
| Edit message | `components/Message/MessageEditForm.tsx` | partial: others' edits apply live; no edit command (`EditLastMessage` logs) |
| Delete message | `messageActions.ts` | partial: deletions apply live; no delete command |
| Message actions: hover toolbar, context menu, copy content | `components/Message/MessageToolbar.tsx`, `MessageContextMenu.tsx`, `MessageActionsSheet.tsx` | partial: copy via selection and Ctrl+C; no toolbar or menu |
| Pins: pin/unpin, pinned panel | `components/Moderation/PinnedMessagesPanel.tsx` | partial: core ingests pin events; no command, no panel |
| Message search (panel, results, jump) | `components/Message/MessageSearch*.tsx`, `hooks/useMessageSearch.ts`, route `channel/:channelId/search` | not started |
| Attachments: send from dialog, paste, drop; progress; retry/remove | `hooks/useMessageFileUpload.ts`, `components/Message/PendingAttachments.tsx`, `DropZoneOverlay.tsx` | done |
| Attachments: images inline, file cards, image viewer, Save as | `components/Message/MessageAttachments.tsx`, `ImageLightbox.tsx`, `DownloadLink.tsx` | done (fixed-size boxes until server thumbnails, U12) |
| Attachments: video and audio playback | `components/Message/VideoPreview.tsx`, `AudioPlayer.tsx`, `hooks/useVideoUrl.ts` | not started (`AttachmentKind::Video/Audio` exist; no player) |
| Link previews | `components/Message/LinkPreviewCard.tsx`, `MessageLinkPreviews.tsx` | partial: title and description; images off pending Mike's decision |
| Custom emoji in messages | `components/Message/MessageSpan.tsx` | done |
| Webhook messages | `components/Message/MessageComponent.tsx` | done (`WebhookView`) |
| Typing indicators (send and show) | `hooks/useTypingEmitter.ts`, `components/Message/TypingIndicator.tsx` | done |
| Mark read; unread divider; DM "seen by" | `hooks/useReadReceipts.ts`, `components/Message/UnreadMessageDivider.tsx`, `SeenByTooltip.tsx`, `hooks/useDmPeerReads.ts` | partial: `mark_read` done; no unread divider or seen-by found |
| Screen-reader announcements of new messages | `hooks/useMessageListAnnouncer.ts` | done (T5) |

### DMs, groups and friends

| Feature | Web client | Native |
|---|---|---|
| DM and group list | `components/DirectMessages/DirectMessageList.tsx`, `DmListItem.tsx` | not started (core has no `direct-messages` read; route is a placeholder) |
| DM conversation | `components/DirectMessages/DirectMessageContainer.tsx`, `DMChatHeader.tsx` | partial: core loads and sends `Conversation::DirectMessage`; no UI route |
| Create DM / group | `components/DirectMessages/CreateDmDialog.tsx` | not started |
| DM unread counts | `hooks/useDmGroup.ts` | partial: in `RailCounts`; nothing lists them |
| Friends: list, requests, add | `components/Friends/`, `pages/FriendsPage.tsx` | not started |

### Voice, video, screen share, replay

| Feature | Web client | Native |
|---|---|---|
| Join/leave a voice channel, presence heartbeat, pre-join screen | `hooks/useVoiceConnection.ts`, `useVoicePresenceHeartbeat.ts`, `components/Voice/VoiceChannelPreJoin.tsx` | done |
| Mute, deafen | `features/voice/voiceActions.ts`, `hooks/useDeafenEffect.ts` | done |
| Speaking indicators | `hooks/useSpeakingDetection.ts` | done |
| Remote video tiles, stage layout | `components/Voice/VideoTiles.tsx`, `StageSplit.tsx`, `VoiceParticipantGrid.tsx` | done (receive only) |
| Persistent call bar elsewhere in the app | `components/Voice/VoiceBottomBar.tsx` | done |
| Float card, dock zones, persistent overlay | `components/Voice/FloatCard.tsx`, `DockZonesOverlay.tsx`, `PersistentVideoOverlay.tsx` | not started |
| Rejoin and recovery after network loss | `hooks/useVoiceRecovery.ts`, `features/voice/reconnectControl.ts` | done (fresh tokens per rejoin) |
| Connection quality indicator | `components/Voice/ConnectionQualityIndicator.tsx` | done |
| Input/output device selection | `components/Voice/DeviceSettingsDialog.tsx`, `hooks/useDeviceSettings.ts` | done (two-list dialog) |
| Device test, mic level meter | `hooks/useDeviceTest.ts` | not started |
| Voice processing (echo, noise, AGC, voice isolation, mic quality), VAD threshold | `hooks/useVoiceSettings.ts`, `components/Settings/AudioVideoSettingsPanel.tsx` | partial: engine has `set_processing`, `set_mic_preset`; no settings UI or persistence |
| Push-to-talk | `hooks/usePushToTalk.ts` (in-window key only) | partial: engine `set_ptt_*` and UI `PttState`; no key binding |
| Per-user volume, screen-share volume | `components/Voice/VoiceUserContextMenu.tsx`, `ScreenShareVolumeControl.tsx`, `features/voice/volumeStorage.ts` | partial: engine `set_participant_volume`; no UI |
| Server mute state; moderator mute/remove from voice | `hooks/useServerMuteEffect.ts`, `useServerMutedVoiceUsers.ts`, `VoiceUserContextMenu.tsx` | partial: being removed is handled; server-mute state unknown; no moderator actions |
| DM voice calls, incoming call banner | `components/DirectMessage/` | not started (core ingests `dmVoice*` events only) |
| Soundboard playback | `components/Voice/SoundboardButton.tsx`, `features/voice/soundboardPlayer.ts` | not started |
| Join/leave and notification sounds | `hooks/useVoicePresenceSounds.ts`, `hooks/useSound.ts` | not started |
| System audio share (audio only) | Electron `setDisplayMediaRequestHandler` audio | done (T11, `semaphore-sysaudio`); screen picture is the placeholder unit |
| Camera publish | `hooks/useLocalMediaState.ts`, `hooks/useVoicePublishPermissions.ts` | not started (placeholder unit) |
| Screen share publish, quality settings, source picker | `hooks/useScreenShare.ts`, `features/voice/screenSharePublish.ts`, `components/Voice/ScreenSourcePicker.tsx`, `utils/screenShare*.ts` | not started (placeholder unit) |
| Replay buffer, capture, trim, clip library, share clip | `hooks/useReplayBuffer.ts`, `components/Voice/CaptureReplayModal.tsx`, `TrimTimeline.tsx`, `components/Profile/ClipLibrary.tsx`, `ShareClipDialog.tsx`, `docs-site/docs/architecture/replay-buffer.md` | not started |
| Voice debug panel, join-failure diagnostics upload | `components/Voice/VoiceDebugPanel.tsx`, `features/voice/voiceDiagnostics.ts`, `backend/src/voice-diagnostics` | not started |
| Keep awake during a call | `hooks/useWakeLock.ts`, `electron/main.ts` power-save blocker | not started |

### Presence

| Feature | Web client | Native |
|---|---|---|
| Online/offline in the member list, live | `components/Message/UserStatusIndicator.tsx` | done |
| Idle/away from activity | `hooks/useActivityDetector.ts` | unknown (nothing found) |
| Status dot on avatars outside the member list | `components/Common/UserAvatar.tsx` | unknown |

### Notifications

| Feature | Web client | Native |
|---|---|---|
| Notification centre and page (list, mark read, unread count) | `components/Notifications/`, `pages/NotificationsPage.tsx`, `hooks/useNotifications.ts` | not started (core reads the unread count only) |
| OS notifications for mentions/DMs, click to open | `hooks/useNotificationSideEffects.ts`, `utils/notifications.ts`, `electron/main.ts` `notification:*` | partial: `DesktopNotifier` exists; core has no "notify" event, no click handling |
| Notification settings: sound, quiet hours (DND), per-channel | `components/Settings/NotificationSettings.tsx`, `utils/dnd.ts` | not started |
| Auto-mark notifications read on view | `hooks/useAutoMarkNotificationsRead.ts` | not started |
| Unread badge (taskbar / tray) | `hooks/useAppBadge.ts` | partial: core `Tray::set_unread` trait; no implementation |
| Web Push (service worker, VAPID) | `hooks/usePushNotifications.ts`, `sw-custom.ts`, `utils/swPush.ts` | n/a on desktop (see section 4) |

### User profile and settings

| Feature | Web client | Native |
|---|---|---|
| Profile view and modal | `pages/ProfilePage.tsx`, `components/Profile/UserProfileModal.tsx` | not started |
| Edit profile: display name, avatar, banner | `pages/ProfileEditPage.tsx`, `components/Profile/UserAvatarUpload.tsx`, `UserBannerUpload.tsx` | not started |
| Settings: Notifications tab | `pages/SettingsPage.tsx` | not started |
| Settings: Voice and video tab | `components/Settings/AudioVideoSettingsPanel.tsx`, `VoiceSettings.tsx` | partial: device dialog only |
| Settings: Appearance (theme, synced) | `hooks/useThemeSync.ts`, `backend/src/appearance-settings` | unknown: theme tokens and modes exist in `ui/src/theme`; user choice and server sync not found |
| Settings: Sessions (list, revoke, revoke others) | `components/Settings/SessionsSettings.tsx` | not started |
| Settings: Desktop app (close to tray, backend URL) | `pages/SettingsPage.tsx` | not started |
| Keyboard shortcuts (Alt+arrows, Esc marks read, Mod+/ sheet) | `hooks/useGlobalShortcuts.ts`, `components/Shortcuts/`, `docs-site/docs/keyboard-shortcuts.md` | unknown: Tab/arrow navigation exists (T5); these shortcuts not found |

### Community settings, roles, moderation, invites

All live under `pages/EditCommunityPage.tsx` tabs and `components/Community/`, `components/Moderation/`.

| Feature | Web client | Native |
|---|---|---|
| Community settings: name, description, avatar, banner, delete | `components/Community/CommunitySettingsForm.tsx`, `CommunityAvatarUpload.tsx`, `CommunityBannerUpload.tsx` | not started |
| Members tab | `components/Community/MemberManagement.tsx` | not started |
| Channels tab: create, edit, delete, reorder | `components/Community/ChannelManagement.tsx`, `CreateChannelDialog.tsx`, `EditChannelDialog.tsx` | not started |
| Private channel membership | `components/Community/PrivateChannelMembership.tsx`, `components/Community/components/` | not started |
| Roles: editor, assignment | `components/Community/RoleManagement.tsx`, `RoleEditor.tsx`, `RoleAssignmentDialog.tsx`, `features/roles/` | not started |
| Channel permission overrides | `components/Community/ChannelPermissionsTab.tsx` | not started |
| Mention groups (aliases) | `components/Community/AliasGroupManagement.tsx`, `AliasGroupEditor.tsx` | not started |
| Custom emoji management | `components/Community/CustomEmojiManagement.tsx` | not started |
| Soundboard management | `components/Community/SoundboardManagement.tsx` | not started |
| Webhooks management | `components/Community/WebhookManagement.tsx` | not started |
| Invites management | `components/Community/InviteManagement.tsx` | not started |
| Moderation: ban, kick, timeout dialogs; user moderation menu | `components/Moderation/BanDialog.tsx`, `KickConfirmDialog.tsx`, `TimeoutDialog.tsx`, `UserModerationMenu.tsx` | not started |
| Moderation: ban list, timeout list, moderation log | `components/Moderation/BanListPanel.tsx`, `TimeoutListPanel.tsx`, `ModerationLogsPanel.tsx` | not started |
| Permission-gated UI (show actions by role) | `features/roles/RoleBasedComponents.tsx`, `useUserPermissions.ts` | partial: per-channel permissions only (`ChannelPermissions`); no community/instance permission set |

### Instance admin (`pages/admin/`, `components/admin/`)

| Feature | Web client | Native |
|---|---|---|
| Admin dashboard and attention items | `pages/admin/AdminDashboard.tsx`, `adminAttention.ts` | not started |
| Users (incl. admin password reset) | `pages/admin/AdminUsersPage.tsx`, `components/admin/ResetPasswordDialog.tsx` | not started |
| Communities | `pages/admin/AdminCommunitiesPage.tsx` | not started |
| Instance invites | `pages/AdminInvitePage.tsx` | not started |
| Instance roles | `pages/admin/AdminRolesPage.tsx` | not started |
| Storage and quotas | `pages/admin/AdminStoragePage.tsx` | not started |
| Instance settings (name, registration mode, quotas, max file size) | `pages/admin/AdminSettingsPage.tsx` | not started |
| Debug: event injection, notification and PWA debug | `pages/admin/AdminDebugPage.tsx`, `components/admin/debug/`, `pages/debug/` | not started (PWA debug n/a) |

### Electron-only

| Feature | Web client | Native |
|---|---|---|
| Secure refresh-token storage | `electron/main.ts` `secure-storage:*` (safeStorage), `components/Electron/SecureStorageWarning.tsx` | done (OS keyring via `keyring`; locked-keyring prompt) |
| Sleep/resume and network events | `electron/main.ts` powerMonitor, `onSystemResume` | done (logind/NetworkManager, Windows power and IP notifications) |
| Clipboard write | `electron/main.ts` `clipboard:write` | done |
| Deep links `semaphore://` (community, channel, DM, invite) | `electron/deep-link-parser.ts`, `hooks/useDeepLinks.ts`, `utils/deepLinkStash.ts` | partial: `DeepLink` to `Route` mapping in `ui/src/nav`; no OS scheme registration, no argv/IPC intake (`main.rs` takes `--server` only) |
| Single instance (second launch focuses the first, forwards links) | `electron/main.ts` `requestSingleInstanceLock` | not started |
| System tray: show/hide, close to tray, check updates, quit | `electron/main.ts` `setupTray`, `buildTrayContextMenu` | not started (trait only) |
| Application menu | `electron/main.ts` `setupApplicationMenu` | not started |
| Auto-update (check, progress, install) | `electron/main.ts` electron-updater, `components/Electron/AutoUpdater.tsx` | not started |
| Window position/size remembered | `electron/main.ts` window state | not started (`main.rs` opens centred) |
| Native notifications with click | `electron/main.ts` `notification:*` | partial (see Notifications) |
| Screen source picker | `components/Voice/ScreenSourcePicker.tsx`, `electron/main.ts` `desktop-capturer:get-sources` | not started (placeholder unit) |
| Voice event log file | `electron/voiceLog.ts` | partial: `SEMAPHORE_LOG` to stderr; no log file |
| App version shown | `electron/preload.ts` `getAppVersion` | unknown |
| Auto-start at login | claimed in `docs-site/docs/installation/desktop-app.md`; no `setLoginItemSettings` in `electron/main.ts` | n/a (Electron doesn't have it either) |

### Web/PWA-only (not counted)

PWA install prompt and settings (`components/PWA/`, `hooks/useInstallPrompt.ts`, `components/Settings/InstallAppSettings.tsx`), service-worker update toast, mobile/tablet layouts (`components/Mobile/`; native has its own phone-width layout, `ui/src/shell/phone.rs`), haptics, swipe gestures, `theme-color` meta. The offline banner's equivalent is the native "You're offline" chip (done).

### Counts

| Area | Done | Partial | Not started | Unknown |
|---|---|---|---|---|
| Auth and onboarding | 4 | 2 | 4 | 0 |
| Communities and channels | 7 | 0 | 3 | 0 |
| Messaging | 14 | 8 | 5 | 0 |
| DMs, groups, friends | 0 | 2 | 3 | 0 |
| Voice, video, replay | 9 | 4 | 10 | 0 |
| Presence | 1 | 0 | 0 | 2 |
| Notifications | 0 | 2 | 3 | 0 |
| Profile and settings | 0 | 1 | 5 | 2 |
| Community settings, roles, moderation | 0 | 1 | 13 | 0 |
| Instance admin | 0 | 0 | 8 | 0 |
| Electron-only | 3 | 3 | 6 | 1 |
| **Total** | **38** | **23** | **60** | **5** |

(n/a rows are left out.)

## 2. Build units

### Shared files that force ordering

| File | Why it serialises |
|---|---|
| `semaphore-core/src/model.rs`, `platform.rs` (`CoreEvent`), `realtime.rs` | Frozen view models every UI unit reads; changed only by the coordinator's core lane |
| `semaphore-ffi/src/lib.rs` | `#[uniffi::remote]` mirror of `model.rs`: every model change edits it too |
| `semaphore-core/src/commands.rs` (1,690 lines, one `impl Core`) | Every feature adds commands here |
| `semaphore-core/src/backend.rs` (`Backend` trait), `semaphore-net/src/backend.rs` (`HttpBackend`) | Every new endpoint adds a trait method and its impl |
| `semaphore-core/src/events.rs` | Every new socket event rule |
| `semaphore-fake-server/src/http.rs`, `socket.rs` | Every new endpoint and event the e2e drives |
| `semaphore-app/src/root.rs` (routes, overlays), `conversation.rs` | Every new screen and message action is wired here |
| `semaphore-ui/src/lib.rs`, `stories.rs` | One line per new UI module |
| `rigs/slice/scripts/text.steps`, `scripts/slice-e2e.sh` | One steps file today; every unit appends |
| `fixtures/scenarios`, `tools/web-export/scenarios*` | Scenario data UI stories and the fake server share |

So each wave runs as: **one core-lane unit** (owns every file in the first six rows for that wave),
**UI units** in their own `ui/src/<feature>` directories against fixtures (the U8-U10 pattern), and
**one app-wiring unit** that lands after them (owns `semaphore-app` and the wave's steps file).
A wave's app wiring runs in parallel with the next wave's core lane and UI units: disjoint files.
At most three UI units build at once (`slice-units/README.md` rule). A wave starts with a **model
freeze**: the core lane's first commit lands the wave's view models, command signatures (returning
`CoreError::Unavailable`), the ffi mirror, and `pub mod` plus story lines for the wave's new UI
directories; UI units branch after it.

Done conditions use the existing gates: `native/scripts/in-image.sh scripts/verify.sh` (build, test,
fmt, clippy, deny, Windows checks) and `native/scripts/in-image.sh scripts/slice-e2e.sh` (two runs,
identical static shots). "Stories" means the unit's stories render in `rigs/shot` and are listed by
`semaphore-ui` `stories::all()`.

### Wave 0: foundations (all parallel)

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W0-contract | Repin `contract/` to a backend ref with the client-type contract (`security/release` + the API-contract stack) once it exists; regenerate wire/api; drop U7's hand-set headers if generated | `contract/`, `semaphore-wire`, `semaphore-api`, `semaphore-net/src/backend.rs` headers | Backend ref (owner/backend lane) | S | `pin-contract.sh` clean, `verify.sh` green, existing `slice-e2e.sh` green |
| W0-seams | Split `commands.rs` into `commands/<area>.rs` (`impl Core` blocks), `Backend` into per-area traits or files, fake-server `http.rs` into per-area routers, `model.rs` into re-exported `model/<area>.rs`. No behaviour change. Needs the coordinator's approval (frozen files) | `semaphore-core/src/{commands,model,backend}*`, `semaphore-fake-server/src/http*`, `semaphore-ffi` imports | none | M | `verify.sh` and `slice-e2e.sh` green with no shot diff. If approved, later waves can run two core-lane units at once (one area each) |
| W0-e2e-multi | `slice-e2e.sh` runs every `rigs/slice/scripts/*.steps` (or a list), so each wave adds its own steps file instead of appending to `text.steps` | `scripts/slice-e2e.sh`, `rigs/slice/src` (step verbs as needed) | none | S | `slice-e2e.sh` runs `text.steps` plus an empty `w0.steps`, both runs identical |
| W0-settings | Local settings store (JSON under `data_dir`, typed, versioned): voice settings, volumes, close-to-tray, window state, last channel; read at start | new `semaphore-app/src/settings.rs`, `semaphore-platform-desktop` paths | none | S | core-free unit tests for load/save/migrate-version; app starts with and without a file |
| W0-real-smoke | The real-backend smoke test from `slice-app.md` (sign in, lists, send, mention, restart rotates token, revoked session signs out) | `scripts/` new `slice-real.sh`, `rigs/slice/scripts/real.steps` | W0-contract, a backend build | M | `slice-real.sh` green against a per-ticket `test-stack.sh` backend |

### Wave 1: messaging completeness

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W1-core | Edit, delete, pin/unpin, pinned list, add any reaction, reaction users, thread send and subscribe/unsubscribe, message search, unread divider position, message link jump | core lane files, `semaphore-net/src/backend.rs`, fake server | W0-seams (optional) | L | core unit tests per command and event; fake server serves each endpoint; `verify.sh` |
| W1-ui-actions | Hover toolbar, context menu (reply, thread, react, edit, copy, delete, pin), inline edit form, unread divider, reaction tooltip | `ui/src/messages` | W1 model freeze | M | stories: toolbar, menu per permission set, edit form, divider; `semaphore-ui` tests |
| W1-ui-emoji | Emoji picker: unicode data exported from the web's `emojiData.ts`, custom emoji, search, keyboard grid navigation; used by composer and reactions | new `ui/src/emoji`, `tools/web-export/emoji*` (new) | W1 model freeze | M | stories: empty search, long custom list, phone width; keyboard nav tests |
| W1-ui-composer | Edit-in-place mode, start reply from an event, thread-composer variant, emoji insertion | `ui/src/composer` | W1 model freeze | M | composer tests for each mode; stories |
| W1-ui-panels | Docked side panel container, pins panel, search panel and results, thread pane | new `ui/src/panel`, new `ui/src/thread` | W1 model freeze | L | stories: each panel loading/empty/error/long; phone-width overlay |
| W1-app | Wire all of the above; `Route` for search; thread pane opens from `OpenThread` | `semaphore-app/src/{root,conversation}.rs`, `rigs/slice/scripts/w1.steps` | W1-core, all W1-ui | M | `slice-e2e.sh` with `w1.steps`: edit, delete, pin, react, thread reply, search hit, both runs identical |

**W1 defaults** (chosen for the owner, who may overrule; 2026-11-10):

- A moderator deleting someone else's message soft-removes it (`DELETE /moderation/message/{id}`), so moderators keep its text and reason. The author's own delete stays a hard delete (`DELETE /messages/{id}`). The web hard-deletes in both cases.
- The unread divider stays where it was when the conversation opened. It doesn't move as messages are read, as the web's does.
- No "Copy message link" and no `semaphore://` message link in this wave. `parse_message_link` reads the web's `?highlight=` paths.
- Editing may remove attachments, as on the web.
- Moderator permissions (pin, remove, see removed) come from `rolesControllerGetMyRolesForChannel` until the backend adds capability flags (section 4, "Asks from W1").

### Wave 2: DMs, friends, notifications, desktop integration

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W2-core | DM list read, create DM/group, friends (list, requests, add, accept, remove), notification list/mark read, a `Notify` decision (mention/DM, DND, per-channel level, focused conversation), notification settings, per-channel levels, idle/away presence, unread total for the badge | core lane files, net, fake server, `platform.rs` (`CoreEvent` or `Notifier` use) | W1-core | L | core tests for the notify decision table (DND window, muted channel, focused conversation), DM/friends commands; `verify.sh` |
| W2-ui-dms | DM list, DM header, create DM/group dialog | new `ui/src/dms` | W2 freeze | M | stories: empty, many groups, long names, phone |
| W2-ui-friends | Friends panel, requests, add form | new `ui/src/friends` | W2 freeze | S | stories: empty, pending both ways, error |
| W2-ui-notifications | Notification centre list, per-channel level menu | new `ui/src/notifications` | W2 freeze | M | stories: empty, unread mix, long; tests for mark-read events |
| W2-desktop | Tray (show/hide, close to tray, quit, unread badge) on Linux (StatusNotifier) and Windows; notification click to route; `semaphore://` registration (Linux `.desktop` `x-scheme-handler`, Windows registry), single instance with link forwarding; window state restore | `semaphore-platform-desktop`, `semaphore-app/src/main.rs`, `services.rs` | W0-settings | L | platform unit tests (link parse, forward over the single-instance socket/pipe); `verify.sh` incl. Windows clippy; manual checklist added to `slice-app.md` |
| W2-app | Wire DMs route, friends route, notification centre, OS notifications from `Notify`, deep-link intake | `semaphore-app/src/{root,conversation}.rs`, `rigs/slice/scripts/w2.steps` | W2-core, W2-ui-*, W2-desktop | M | `w2.steps`: open DM, send, create group, friend request, mention raises a notify (fake `Notifier` records it), deep link opens a channel |

### Wave 3: account, settings, auth extras, media playback

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W3-core | Profile get/update with avatar/banner upload, sessions list/revoke, appearance settings, register, forgot/reset password, invite preview/join, create community, browser sign-in (PKCE, loopback listener) | core lane files, net, fake server | W2-core, W0-contract (browser sign-in, sessions) | L | core tests incl. PKCE verifier/challenge and loopback state; fake server endpoints |
| W3-ui-profile | Profile modal and page, edit form, avatar/banner pickers | new `ui/src/profile` | W3 freeze | M | stories: own/other, no avatar, long bio, phone |
| W3-ui-settings | Settings shell and tabs: notifications, voice and video (processing, VAD, PTT key capture, device test meter), appearance, sessions, desktop app | new `ui/src/settings` | W3 freeze | L | stories per tab and error states; PTT key capture tests |
| W3-ui-auth | Register, forgot/reset, browser sign-in panel, invite join page, create-community form, home sections and zero-community gate | `ui/src/auth`, new `ui/src/home` | W3 freeze | M | stories: each form's errors, registration modes (open/invite/closed) |
| W3-player | Video and audio playback for attachments (and later clips): decode choice, authenticated range/signed-URL fetch, controls | new crate (e.g. `semaphore-player`), new `ui/src/player` | none (design checkpoint first: decoder choice is a dependency decision) | L | player unit tests on fixture MP4/WebM/OGG; story with a fixture clip; `cargo deny` clean |
| W3-app | Wire profile, settings (persisted via W0-settings), auth routes, invite join, create community, player in messages | `semaphore-app/*`, `rigs/slice/scripts/w3.steps` | W3-core, W3-ui-*, W3-player | M | `w3.steps`: edit profile, revoke a session, join by invite, create community, play a video attachment |

### Wave 4: voice completeness

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W4-core | DM voice (dm-token, DM presence, incoming call), soundboard list/play, moderator voice actions (mute participant, remove), server-mute state, replay start/stop/capture/clips/share, voice diagnostics report | core lane files, net, fake server | W3-core | L | core tests for call state machine incl. incoming-call accept/decline; fake server endpoints |
| W4-media | Soundboard mixing into the published track, processing/PTT/volume settings applied from settings, device test loopback and level meter, join/leave sounds, keep-awake during calls (logind inhibitor / `SetThreadExecutionState`) | `semaphore-media-livekit`, `semaphore-platform-desktop` (inhibit only) | W0-settings | M | engine tests with `testing.rs` fakes; `slice-e2e.sh --voice` still green |
| W4-ui-voice | Incoming call banner, DM call controls, participant context menu (volume, moderator mute/remove), soundboard button, float card and dock zones, voice debug panel | `ui/src/voice` | W4 freeze | L | stories: each state, moderator vs member, phone |
| W4-ui-replay | Capture modal, trim timeline, clip library, share dialog | new `ui/src/replay` | W4 freeze, W3-player | M | stories: empty library, long clip, capture failure |
| W4-av-publish (placeholder) | Camera publish, screen share publish with quality, source picker, screen audio | designed separately | separate design | L | defined by that design |
| W4-app | Wire DM calls, soundboard, moderator actions, replay, debug panel | `semaphore-app/src/{voice,root}.rs`, `rigs/slice/scripts/voice-w4.steps` | W4-core, W4-media, W4-ui-* | M | `slice-e2e.sh --voice` with the new steps: DM call between rig and publisher, soundboard play, server mute, capture a clip |

### Wave 5: community administration and moderation

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W5-core | Community update/delete, channel CRUD and reorder, private channel membership, roles CRUD/assign, channel permission overrides, community/instance permission set for gating, alias groups, custom emoji, soundboard, webhooks, invites management, ban/kick/timeout, ban/timeout lists, moderation log | core lane files, net, fake server | W4-core | L (split in two with W0-seams) | core tests per command; permission-set gating tests |
| W5-ui-community | Community settings shell and tabs: overview, members, channels, private channels, mention groups, emoji, soundboard, webhooks, invites | new `ui/src/community_settings` | W5 freeze | L | stories per tab with empty/long/error and permission variants |
| W5-ui-roles | Role list, role editor (permission matrix), assignment dialog, channel permission overrides | new `ui/src/roles` | W5 freeze | M | stories: many roles, owner vs admin, phone |
| W5-ui-moderation | Ban/kick/timeout dialogs, user moderation menu, ban and timeout lists, moderation log | new `ui/src/moderation` | W5 freeze | M | stories per dialog and list state |
| W5-app | Wire community settings route, role-gated actions across the shell | `semaphore-app/*`, `rigs/slice/scripts/w5.steps` | W5-core, W5-ui-* | M | `w5.steps`: create channel, edit role, timeout a member (composer locks), ban, invite created |

### Wave 6: instance admin and first run

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W6-core | Admin users/communities/invites/roles/storage/settings, admin password reset, onboarding status and setup | core lane files, net, fake server | W5-core | M | core tests; fake server endpoints |
| W6-ui-admin | Admin layout and pages | new `ui/src/admin` | W6 freeze | L | stories per page, empty/long/error |
| W6-ui-onboarding | First-run wizard (welcome, instance, admin, community, done) | new `ui/src/onboarding` | W6 freeze | M | stories per step and validation errors |
| W6-app | Wire admin routes and onboarding gate | `semaphore-app/*`, `rigs/slice/scripts/w6.steps` | W6-core, W6-ui-* | S | `w6.steps`: fresh fake instance runs the wizard; admin changes registration mode |

### Wave 7: remaining media

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W7-gifs | GIF search/featured picker, animated GIF/WebP embeds (frame limit) | core lane (gifs endpoints), new `ui/src/gifs`, `ui/src/messages/media.rs` | W1-ui-emoji, Mike's third-party image decision | M | stories; fake server gifs endpoints; frame-limit tests |
| W7-thumbnails | Server-sized thumbnails (U12) so image boxes size correctly | `backend/` (U12, API-contract stack), core, `ui/src/messages` | U12 landing | S | core test on dimensions; story shot with mixed aspect ratios |
| W7-preview-images | Link-preview images per Mike's decision (direct fetch with the existing limits, or a server proxy) | `semaphore-app/src/files.rs`, possibly `backend/` | Mike's decision | S | `slice-e2e.sh` link-preview step flips from "unrequested" to drawn |

### Wave summary

| Wave | Units (parallel) | Then |
|---|---|---|
| 0 | W0-contract, W0-seams, W0-e2e-multi, W0-settings | W0-real-smoke |
| 1 | W1-core; W1-ui-actions, W1-ui-emoji, W1-ui-composer, W1-ui-panels (3 at once) | W1-app |
| 2 | W2-core, W2-desktop; W2-ui-dms, W2-ui-friends, W2-ui-notifications; W1-app | W2-app |
| 3 | W3-core, W3-player; W3-ui-profile, W3-ui-settings, W3-ui-auth; W2-app | W3-app |
| 4 | W4-core, W4-media, W4-av-publish; W4-ui-voice, W4-ui-replay; W3-app | W4-app |
| 5 | W5-core; W5-ui-community, W5-ui-roles, W5-ui-moderation; W4-app | W5-app |
| 6 | W6-core; W6-ui-admin, W6-ui-onboarding; W5-app | W6-app |
| 7 | W7-gifs, W7-thumbnails, W7-preview-images (each when unblocked) | |

## 3. Cross-cutting work

| Item | Electron today | Native needs | Size |
|---|---|---|---|
| Installers, Windows | NSIS via electron-builder (`.github/workflows/electron-build.yml`) | MSI or NSIS/Inno for the GPUI binary, VC runtime, `semaphore://` registration, Start menu entry | M |
| Installers, Linux | AppImage, .deb, .rpm (electron-builder) | Same three (or Flatpak); `.desktop` with `x-scheme-handler/semaphore`, icons, keyring and PipeWire runtime deps | M |
| Auto-update | electron-updater against GitHub Releases; per-format quirks (.deb pkexec, CLAUDE.md patch notes) | An updater (e.g. a signed manifest on Releases plus per-format install: AppImage replace, MSI/NSIS run, .deb/.rpm via package manager or notify-only) | L |
| Code signing | none found in `electron-build.yml` | Decide: Windows Authenticode (SmartScreen), update manifest signing (needed regardless for a safe updater) | M |
| Crash reporting | none (no `crashReporter`) | Panic hook writing a report to the log dir; remote reporting only if Mike decides | S |
| Logging | `electron/voiceLog.ts` writes voice events to a log file; console otherwise | Rotating log file under the data dir (`SEMAPHORE_LOG` today is stderr only); "open log folder" in settings | S |
| Localisation | none (no i18n library in `frontend/src`) | none for parity; keep strings in one place per UI module | n/a |
| Accessibility | MUI/ARIA, `useMessageListAnnouncer`, shortcut sheet | Orca pass done (T5); each UI unit keeps labels; a Windows Narrator pass is not done (unknown) | M |
| Telemetry | none found (backend `metrics` is server-side; voice diagnostics upload is a feature, W4) | none | n/a |
| CI on main | `native-spike.yml` runs on pushes to `spike/native-gpui` only (paths filter); header says no job had run as of Phase 0 | PR and `main` triggers, `verify.sh` and both `slice-e2e.sh` runs, Windows link job, release job for installers | M |
| Settings migration from Electron | `userData/settings.json` (`closeToTray`), window state file, safeStorage-encrypted refresh token, renderer `localStorage` (voice settings, volumes, device ids, server URL, drafts) | Import `settings.json` and server URL; the token and `localStorage` live in Chromium's encrypted store and LevelDB: re-sign-in is the realistic path (decide) | S-M |
| Coexistence with Electron | n/a | Both register `semaphore://`; decide which wins while both are installed | S |

## 4. Web-client paths the backend contract doesn't serve to a non-web client

Checked against `backend/` on this branch (same as `main` v0.7.0 for these files) and `security/release`.

| Path | What the backend does | Effect on native | Where fixed |
|---|---|---|---|
| Refresh token in the response body | `auth.controller.ts` `respondWithNewSession` and `refresh` return the refresh token in the body only when `User-Agent` contains `Electron`; otherwise cookies only | A native client on a v0.7.0 backend gets no refresh token | `main` after v0.7.0 (`client-type.util.ts`, `X-Client-Type: desktop-native`); pinned and sent as generated header parameters since W0-contract |
| Refresh throttling | `refresh-throttler.guard.ts` reads a body refresh token only for `Electron` user agents | Throttling misses native refreshes on `main` | `security/release` (`presentedRefreshToken`) |
| Sessions list "current" marker | `getCurrentTokenId` reads the refresh cookie only on `main` | Native's own session isn't marked current, so "sign out other sessions" could include it | `security/release` falls back to the access token's `sid` |
| Push notifications | `push-notifications` is Web Push only (VAPID key, subscription `endpoint`) | No push when the app isn't running; desktop native must rely on the live socket. Mobile later needs FCM/APNs/UnifiedPush backend work | not planned anywhere found |
| Inline video/audio | Web `<video src>` relies on the httpOnly `access_token` cookie; Electron fetches `/file/:id/signed-url` | Native can use the signed URL or bearer fetches: available, but the player must do its own auth | n/a (available) |
| Replay preview (HLS) | `livekit/replay/preview/playlist.m3u8` and segment URLs sit behind `JwtAuthGuard` (header or cookie) | A native HLS player must add `Authorization` to segment fetches | n/a (available) |
| Password reset link | `mailer.service.ts` builds `${publicAppUrl}/reset-password?token=...`, a web URL | The email always opens the web app; `semaphore://` has no reset route | web flow is acceptable unless native should handle it (decide) |
| Third-party media | Link-preview images and GIF media (`gifs` returns Giphy URLs) are loaded by the browser straight from third parties | Native must fetch them directly (exposes the viewer's IP) or the backend needs a proxy | pending Mike's decision |
| Browser sign-in | `auth/desktop/authorize` + `auth/desktop/token` (PKCE, loopback) exist and are in the native pin | Usable: the redeem takes the client-type headers (W0-contract pin). Authorize now also needs the account's `password` | `main` |

### Asks from W1 for the backend lane

Things the contract makes awkward for a non-web client, found while designing W1-core (2026-11-10). None blocks W1; each has a workaround in core.

| Ask | Why | Native's workaround meanwhile |
|---|---|---|
| `pin`, `deleteAny` and `seeRemoved` flags on `ChannelCapabilitiesDto` | The web decides pin and moderator delete from RBAC actions (`useCanPerformAction`); native already reads channel capabilities for everything else | Reads `rolesControllerGetMyRolesForChannel` and checks the role actions |
| Say soft or hard in the `deleteMessage` payload | A moderator's soft removal and a hard delete send the same payload, so a client can't tell whether moderators should keep the row | A reader with DELETE_ANY_MESSAGE refetches `GET /messages/{id}`: a removed row stays, a 404 goes |
| A specific `ErrorCode` for a blocked 1:1 DM | `assertNotBlockedInDm` throws a plain FORBIDDEN ("You cannot message this user") for sends, thread replies and edits | Shows the server's message; the composer can't lock itself |
| A block check on reactions in 1:1 DMs | `reactions.service` has none, so a blocked user can still react | none (server gap) |
| Paging for message search | `search/{channel,group,community}` take `q` and `limit` only, newest first | Asks for one page; the UI says when results stop at the limit |
| Effective per-channel capabilities for pin, unpin, delete-any and see-removed | `rolesControllerGetMyRolesForChannel` returns community roles without the channel's permission overwrites, so a channel that denies or grants these is shown wrong (the web client has the same gap) | Uses the community roles, as the web does; the server still refuses what it denies |

### Asks from W2 for the backend lane

Found while building W2-core (2026-11-11). None blocks W2; each has a workaround in core.

| Ask | Why | Native's workaround meanwhile |
|---|---|---|
| Socket events for friendship changes (request sent, accepted, declined, cancelled, removed) | `friends` emits nothing at all, so a client learns of a request only by asking | Reads friends again after its own changes, on reconnect, and when shown while older than 30 s |
| Socket events for DM group changes (created, member added, member left) | `dm-group.*` are internal EventEmitter events only; other members see a new group at its first message | A message for a group the list lacks reads the list again |
| `notificationRead` (or a count event) for read-all, dismiss and the context reads `markAsRead` does | Only a single mark-read is announced, so other devices' badges stay stale | Reads the count again after its own changes and its own `readReceiptUpdated` |
| Leave dismissed rows out of `GET /notifications` (or a filter) | The list returns them, and `total` counts them, so paging and "more" include rows nobody shows | Filters them out; "more" compares raw rows to `total` |
| `channelName` on list rows, `parentMessageId` on `newNotification` | The list DTO lacks the name the event has; the event lacks the thread the list has | Takes names from cached channels; a thread reply's OS notification opens the channel |
| A JSON `null` for "no override" from `GET /notifications/channels/{id}/override` | It answers 200 with an empty body, which the generated client can't decode | A hand-written request for that one call |
| A way to clear a DND time in `UpdateNotificationSettingsDto` that the contract can express | Clearing needs an explicit `null`, which the generated optional field can't send | A hand-written body for settings saves |
| An idle or away status other users can see | Presence is a boolean; `presenceOnline { idle }` only stops push | Sends idle; shows nobody as idle |
| Parse `unreadOnly` as a boolean on `GET /notifications` | Any value, `false` included, is read as true, so `unreadOnly=false` returns only unread rows | Never sends the parameter (`unread_only` only as `Some(true)`) |
| `total` on `GET /notifications` that counts the list | It is the size of the page sent, so a client can't page by it | A full page means "more may follow" |

