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
| Server URL entry and probe (connection wizard) | `components/Electron/ConnectionWizard.tsx` | done (`Core::probe_server`, `ui/src/auth`); the probe now reads `needs_setup` from `GET /onboarding/status` (W9) |
| Password sign-in | `pages/LoginPage.tsx` | done |
| Session restore at start, expired/unreachable handling | `utils/tokenService.ts`, `components/SessionUnavailable.tsx` | done (`restore_session`, Try again / session expired) |
| Sign out | `components/Desktop/RailUserMenu.tsx`, `hooks/useLogout.ts` | done (account menu) |
| Sign in with browser (PKCE, loopback) | `electron/browser-login.ts`, `components/Electron/BrowserLoginPanel.tsx`, `pages/DesktopLoginPage.tsx`, `utils/pkce.ts`, `docs-site/docs/installation/desktop-browser-sign-in.md` | not started (needs the client-type backend, see section 4) |
| Registration (with invite code) | `pages/RegisterPage.tsx` | core done, UI pending: `Core::register` honours the instance's mode (closed = no register, invite-only = code required, open = code optional); `Core::register_requirements` is what the screen shows |
| Forgot / reset password | `pages/ForgotPasswordPage.tsx`, `pages/ResetPasswordPage.tsx` | not started (button opens the web app) |
| First-run instance setup wizard | `pages/OnboardingPage.tsx`, `components/Onboarding/` | not started |
| Join by invite link | `pages/JoinInvitePage.tsx` | core done, UI pending: `Core::invite_preview` (`InvitePreviewView`, with the server's `INVITE_*` reason) and `Core::accept_invite` → `InviteJoin` (joined and skipped communities with reasons) |
| Home: summary, zero-community gate, next step, invite card | `pages/HomePage.tsx`, `components/Home/`, `hooks/useHomeSummary.ts` | partial: the sections and the gate are assembled in `ui/src/home` from existing reads (as the web's `useHomeSummary` does; no core Home view by design); the card's invite creation is W5-core, joining is W9-core (`Core::accept_invite`) |

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
| Threads: pane, replies, thread composer, reply badge, subscribe | `components/Thread/`, `hooks/useThreadReplies.ts`, `hooks/useThreadSubscription.ts` | core done, UI pending: `thread_info`, `set_thread_subscribed`, the thread window and the reply badge's counts (`newThreadReply`, `threadReplyCountUpdated`); `ui/src/thread` exists (W1 lane) |
| Reactions: toggle an existing one | `components/Message/MessageReactions.tsx` | done (`toggle_reaction`) |
| Reactions: add any emoji, who-reacted tooltip | `components/Message/ReactionTooltip.tsx`, `EmojiPicker.tsx` | core done, UI pending: `add_reaction`/`remove_reaction` for any emoji, `reaction_users` (15 names + `more`) |
| Emoji picker (unicode and custom) | `components/Message/EmojiPicker.tsx`, `emojiData.ts`, `utils/emojiGridNavigation.ts` | core done, UI pending: `EmojiView`, the community emoji query, emoji mention candidates and `MessageDraft` insertion; the unicode data and grid are the `ui/src/emoji` lane (it exists) |
| GIF picker and GIF embeds | `components/Message/GifPicker.tsx`, `GifEmbed.tsx`, `backend/src/gifs` | core done, UI pending: `Core::gifs`/`Core::load_more_gifs`, `GifResultsView::{enabled, needs_permission}` (blocked while third-party images are off), `MessageRow::gif` (`GifEmbed.host`) |
| Edit message | `components/Message/MessageEditForm.tsx` | core done, UI pending: `edit_message` (`edit_draft`, optimistic in-place, attachments kept or removed) |
| Delete message | `messageActions.ts` | core done, UI pending: `delete_message` (the author's hard delete; a moderator's soft removal, kept for readers who may see it) |
| Message actions: hover toolbar, context menu, copy content | `components/Message/MessageToolbar.tsx`, `MessageContextMenu.tsx`, `MessageActionsSheet.tsx` | core done, UI pending: every action behind the menu has a command (reply via `MessageDraft`, thread, react, edit, delete, pin, copy through the selection model); the toolbar and menu are the `ui/src/messages` lane |
| Pins: pin/unpin, pinned panel | `components/Moderation/PinnedMessagesPanel.tsx` | core done, UI pending: `pin_message`, `unpin_message`, `pinned_messages` (a pinned thread reply carries its parent) |
| Message search (panel, results, jump) | `components/Message/MessageSearch*.tsx`, `hooks/useMessageSearch.ts`, route `channel/:channelId/search` | core done, UI pending: `search_results`/`load_more_search` per scope, and `open_message_link` for the jump |
| Attachments: send from dialog, paste, drop; progress; retry/remove | `hooks/useMessageFileUpload.ts`, `components/Message/PendingAttachments.tsx`, `DropZoneOverlay.tsx` | done |
| Attachments: images inline, file cards, image viewer, Save as | `components/Message/MessageAttachments.tsx`, `ImageLightbox.tsx`, `DownloadLink.tsx` | done (fixed-size boxes until server thumbnails, U12) |
| Attachments: video and audio playback | `components/Message/VideoPreview.tsx`, `AudioPlayer.tsx`, `hooks/useVideoUrl.ts` | core done, UI pending: `semaphore-player` (docs/player.md) and core's authenticated fetch; the message integration is a UI lane |
| Link previews | `components/Message/LinkPreviewCard.tsx`, `MessageLinkPreviews.tsx` | core done, UI pending: title, description, site name, author and favicon; `LinkPreviewView::image_host` names where a blocked picture would load from; pictures load only while `Core::third_party_media()` is on |
| Custom emoji in messages | `components/Message/MessageSpan.tsx` | done |
| Webhook messages | `components/Message/MessageComponent.tsx` | done (`WebhookView`) |
| Typing indicators (send and show) | `hooks/useTypingEmitter.ts`, `components/Message/TypingIndicator.tsx` | done |
| Mark read; unread divider; DM "seen by" | `hooks/useReadReceipts.ts`, `components/Message/UnreadMessageDivider.tsx`, `SeenByTooltip.tsx`, `hooks/useDmPeerReads.ts` | core done, UI pending: `mark_read`, `UnreadMarker`, `DmPeerReadsView` (watermarks, kept live by `readReceiptUpdated`) and `SeenByView` (a DM's watermark compared with the sent time; a channel's `GET /read-receipts/message/{id}/readers`) |
| Screen-reader announcements of new messages | `hooks/useMessageListAnnouncer.ts` | done (T5) |

### DMs, groups and friends

| Feature | Web client | Native |
|---|---|---|
| DM and group list | `components/DirectMessages/DirectMessageList.tsx`, `DmListItem.tsx` | core done, UI pending: `Core::dm_list` (`DmRow` with members, unread, presence) |
| DM conversation | `components/DirectMessages/DirectMessageContainer.tsx`, `DMChatHeader.tsx` | partial: core loads and sends `Conversation::DirectMessage`; no UI route |
| Create DM / group | `components/DirectMessages/CreateDmDialog.tsx` | core done, UI pending: `Core::create_dm_group`, `add_dm_members`, `leave_dm_group` |
| DM unread counts | `hooks/useDmGroup.ts` | core done: `DmRow.unread`/`mention`, `RailCounts`, `Core::badge_count`; UI pending |
| Friends: list, requests, add | `components/Friends/`, `pages/FriendsPage.tsx` | core done, UI pending: `Core::friends`, `send_friend_request`, `accept_friend_request`, `remove_friend`, `search_users` |

### Voice, video, screen share, replay

| Feature | Web client | Native |
|---|---|---|
| Join/leave a voice channel, presence heartbeat, pre-join screen | `hooks/useVoiceConnection.ts`, `useVoicePresenceHeartbeat.ts`, `components/Voice/VoiceChannelPreJoin.tsx` | join/leave/presence done; the pre-join screen's core half is done, UI pending: `VoicePreJoinView` (who's here, `VoiceJoinMode` none/listen-only/full, timeout, the channel a join would move you from) and `Core::join_voice_with` (join muted/deafened) |
| Mute, deafen | `features/voice/voiceActions.ts`, `hooks/useDeafenEffect.ts` | done |
| Speaking indicators | `hooks/useSpeakingDetection.ts` | done |
| Remote video tiles, stage layout | `components/Voice/VideoTiles.tsx`, `StageSplit.tsx`, `VoiceParticipantGrid.tsx` | done (receive only) |
| Persistent call bar elsewhere in the app | `components/Voice/VoiceBottomBar.tsx` | done |
| Float card, dock zones, persistent overlay | `components/Voice/FloatCard.tsx`, `DockZonesOverlay.tsx`, `PersistentVideoOverlay.tsx` | not started |
| Rejoin and recovery after network loss | `hooks/useVoiceRecovery.ts`, `features/voice/reconnectControl.ts` | done (fresh tokens per rejoin) |
| Connection quality indicator | `components/Voice/ConnectionQualityIndicator.tsx` | done |
| Input/output device selection | `components/Voice/DeviceSettingsDialog.tsx`, `hooks/useDeviceSettings.ts` | done (two-list dialog) |
| Device test, mic level meter | `hooks/useDeviceTest.ts` | not started |
| Voice processing (echo, noise, AGC, voice isolation, mic quality), VAD threshold | `hooks/useVoiceSettings.ts`, `components/Settings/AudioVideoSettingsPanel.tsx` | partial: echo/noise/AGC, mic preset, VAD and push-to-talk are persisted in the app's settings store and applied by the engine; voice isolation has no counterpart in libwebrtc's APM (ask, section 4); no core view, UI pending |
| Push-to-talk | `hooks/usePushToTalk.ts` (in-window key only) | partial: engine `set_ptt_*` and UI `PttState`; no key binding |
| Per-user volume, screen-share volume | `components/Voice/VoiceUserContextMenu.tsx`, `ScreenShareVolumeControl.tsx`, `features/voice/volumeStorage.ts` | participant volume: core `set_participant_volume`, persisted in the app's store and applied on every join. Screen-share volume needs a per-track gain in the engine (the mixer's gain is per identity): media ask. UI pending |
| Server mute state; moderator mute/remove from voice | `hooks/useServerMuteEffect.ts`, `useServerMutedVoiceUsers.ts`, `VoiceUserContextMenu.tsx` | partial: being removed is handled; server-mute state unknown; no moderator actions |
| DM voice calls, incoming call banner | `components/DirectMessage/` | core done, UI pending: `Core::incoming_call`, `join_dm_voice`, `decline_call`; `ui/src/voice/incoming.rs` exists |
| Soundboard playback | `components/Voice/SoundboardButton.tsx`, `features/voice/soundboardPlayer.ts` | core done, UI pending: `Core::soundboard`, `play_sound` (`MediaEngine::play_soundboard`) |
| Join/leave and notification sounds | `hooks/useVoicePresenceSounds.ts`, `hooks/useSound.ts` | core done (`CoreEvent::Sound { cue }`), the app plays them (W4-app); UI pending for the mute switches |
| System audio share (audio only) | Electron `setDisplayMediaRequestHandler` audio | done (T11, `semaphore-sysaudio`); screen picture is the placeholder unit |
| Camera publish | `hooks/useLocalMediaState.ts`, `hooks/useVoicePublishPermissions.ts` | not started (placeholder unit) |
| Screen share publish, quality settings, source picker | `hooks/useScreenShare.ts`, `features/voice/screenSharePublish.ts`, `components/Voice/ScreenSourcePicker.tsx`, `utils/screenShare*.ts` | not started (placeholder unit) |
| Replay buffer, capture, trim, clip library, share clip | `hooks/useReplayBuffer.ts`, `components/Voice/CaptureReplayModal.tsx`, `TrimTimeline.tsx`, `components/Profile/ClipLibrary.tsx`, `ShareClipDialog.tsx`, `docs-site/docs/architecture/replay-buffer.md` | core done, UI pending: `Core::start_replay`/`stop`, `clips`, `user_clips`, `capture_replay`, `trim_replay`, `share_clip`; `ui/src/replay` exists |
| Voice debug panel, join-failure diagnostics upload | `components/Voice/VoiceDebugPanel.tsx`, `features/voice/voiceDiagnostics.ts`, `backend/src/voice-diagnostics` | core done, UI pending: `Core::voice_diagnostics` (classified join failures, engine diagnostics); the upload waits on a native platform value (backend ask W4) |
| Keep awake during a call | `hooks/useWakeLock.ts`, `electron/main.ts` power-save blocker | done (W4: logind inhibitor / `SetThreadExecutionState`, toggled by core) |

### Presence

| Feature | Web client | Native |
|---|---|---|
| Online/offline in the member list, live | `components/Message/UserStatusIndicator.tsx` | done |
| Idle/away from activity | `hooks/useActivityDetector.ts` | done: `Core::set_idle` and the app's `Activity` detector report it; other users see nobody as idle (backend ask #656) |
| Status dot on avatars outside the member list | `components/Common/UserAvatar.tsx` | core done (presence in `MemberView`/`RailCounts`), UI pending |

### Notifications

| Feature | Web client | Native |
|---|---|---|
| Notification centre and page (list, mark read, unread count) | `components/Notifications/`, `pages/NotificationsPage.tsx`, `hooks/useNotifications.ts` | core done, UI pending: `NotificationList`, `mark_notification_read`, `mark_all_notifications_read`, `dismiss_notification`, `load_more_notifications`, `Core::badge_count` |
| OS notifications for mentions/DMs, click to open | `hooks/useNotificationSideEffects.ts`, `utils/notifications.ts`, `electron/main.ts` `notification:*` | partial: core's `Notify`/`WithdrawNotifications` and the notifier (freedesktop on Linux with replace by tag and click with activation token, GPUI toasts on Windows) exist; wiring is W2-app |
| Notification settings: sound, quiet hours (DND), per-channel | `components/Settings/NotificationSettings.tsx`, `utils/dnd.ts` | core done, UI pending: `NotificationSettingsView`, `Core::update_notification_settings`, `Core::channel_notify_level`/`set_channel_notify_level` |
| Auto-mark notifications read on view | `hooks/useAutoMarkNotificationsRead.ts` | core done: opening a channel or DM (`State::w2_auto_read`) reads its unread notifications, and one arriving while it's open is read at once; other conversations are left alone, and a failed mark is retried on the next visit |
| Unread badge (taskbar / tray) | `hooks/useAppBadge.ts` | partial: core `Tray::set_unread` trait; no implementation |
| Web Push (service worker, VAPID) | `hooks/usePushNotifications.ts`, `sw-custom.ts`, `utils/swPush.ts` | n/a on desktop (see section 4) |

### User profile and settings

| Feature | Web client | Native |
|---|---|---|
| Profile view and modal | `pages/ProfilePage.tsx`, `components/Profile/UserProfileModal.tsx` | core done, UI pending: `Core::profile`, `Core::profile_edit` |
| Edit profile: display name, avatar, banner | `pages/ProfileEditPage.tsx`, `components/Profile/UserAvatarUpload.tsx`, `UserBannerUpload.tsx` | core done, UI pending: `update_profile` with avatar/banner uploads (progress, retry, removal) |
| Settings: Notifications tab | `pages/SettingsPage.tsx` | core done, UI pending (the notification settings view above) |
| Settings: Voice and video tab | `components/Settings/AudioVideoSettingsPanel.tsx`, `VoiceSettings.tsx` | partial: device dialog only |
| Settings: Appearance (theme, synced) | `hooks/useThemeSync.ts`, `backend/src/appearance-settings` | core done, UI pending: `Core::appearance`, `set_appearance` (the server's synced theme) |
| Settings: Sessions (list, revoke, revoke others) | `components/Settings/SessionsSettings.tsx` | core done, UI pending: `Core::sessions`, `revoke_session`, `revoke_other_sessions` |
| Settings: Desktop app (close to tray, backend URL, the merged media switch) | `pages/SettingsPage.tsx` | done in the app (`SettingsStore` v3, `ui/src/settings/desktop.rs`); the switch is still labelled "Link preview images" (U9-media) |
| Keyboard shortcuts (Alt+arrows, Esc marks read, Mod+/ sheet) | `hooks/useGlobalShortcuts.ts`, `components/Shortcuts/`, `docs-site/docs/keyboard-shortcuts.md` | unknown: Tab/arrow navigation exists (T5); these shortcuts not found |

### Community settings, roles, moderation, invites

All live under `pages/EditCommunityPage.tsx` tabs and `components/Community/`, `components/Moderation/`.

| Feature | Web client | Native |
|---|---|---|
| Community settings: name, description, avatar, banner, delete | `components/Community/CommunitySettingsForm.tsx`, `CommunityAvatarUpload.tsx`, `CommunityBannerUpload.tsx` | core done (W5), UI pending |
| Members tab | `components/Community/MemberManagement.tsx` | core done (W5), UI pending |
| Channels tab: create, edit, delete, reorder | `components/Community/ChannelManagement.tsx`, `CreateChannelDialog.tsx`, `EditChannelDialog.tsx` | core done (W5), UI pending |
| Private channel membership | `components/Community/PrivateChannelMembership.tsx`, `components/Community/components/` | core done (W5), UI pending |
| Roles: editor, assignment | `components/Community/RoleManagement.tsx`, `RoleEditor.tsx`, `RoleAssignmentDialog.tsx`, `features/roles/` | core done (W5), UI pending |
| Channel permission overrides | `components/Community/ChannelPermissionsTab.tsx` | core done (W5), UI pending |
| Mention groups (aliases) | `components/Community/AliasGroupManagement.tsx`, `AliasGroupEditor.tsx` | core done (W5), UI pending |
| Custom emoji management | `components/Community/CustomEmojiManagement.tsx` | core done (W5), UI pending |
| Soundboard management | `components/Community/SoundboardManagement.tsx` | core done (W5), UI pending |
| Webhooks management | `components/Community/WebhookManagement.tsx` | core done (W5), UI pending |
| Invites management | `components/Community/InviteManagement.tsx` | core done (W5), UI pending |
| Moderation: ban, kick, timeout dialogs; user moderation menu | `components/Moderation/BanDialog.tsx`, `KickConfirmDialog.tsx`, `TimeoutDialog.tsx`, `UserModerationMenu.tsx` | core done (W5), UI pending |
| Moderation: ban list, timeout list, moderation log | `components/Moderation/BanListPanel.tsx`, `TimeoutListPanel.tsx`, `ModerationLogsPanel.tsx` | core done (W5), UI pending |
| Permission-gated UI (show actions by role) | `features/roles/RoleBasedComponents.tsx`, `useUserPermissions.ts` | core done (per-channel capabilities, the community permission set and `InstanceAdminCaps`; an action the rank rule forbids shows disabled with its reason), UI pending |

### Instance admin (`pages/admin/`, `components/admin/`)

| Feature | Web client | Native |
|---|---|---|
| Admin dashboard and attention items | `pages/admin/AdminDashboard.tsx`, `adminAttention.ts` | core done (W6), UI pending |
| Users (incl. admin password reset) | `pages/admin/AdminUsersPage.tsx`, `components/admin/ResetPasswordDialog.tsx` | core done (W6), UI pending |
| Communities | `pages/admin/AdminCommunitiesPage.tsx` | core done (W6), UI pending |
| Instance invites | `pages/AdminInvitePage.tsx` | core done (W6), UI pending |
| Instance roles | `pages/admin/AdminRolesPage.tsx` | core done (W6), UI pending |
| Storage and quotas | `pages/admin/AdminStoragePage.tsx` | core done (W6), UI pending |
| Instance settings (name, registration mode, quotas, max file size) | `pages/admin/AdminSettingsPage.tsx` | core done (W6), UI pending |
| Debug: event injection, notification and PWA debug | `pages/admin/AdminDebugPage.tsx`, `components/admin/debug/`, `pages/debug/` | core done (W6), UI pending (event injection stays unbuilt: owner's decision; PWA debug n/a) |

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

(n/a rows are left out.) These counts are the column before a verification sweep by **W9**
(2026-11-12): the status column was partly out of date, and W9 marked every row whose core half it
verified — the W9 features below, and the core halves of messaging, DMs and friends, notifications,
profile/settings, community settings/roles/moderation and instance admin that had already landed.
Read the column, not this table, as the source of truth.

### W9: the UI-free gaps (done 2026-11-12)

One core lane, `w9-core`, over `semaphore-core`, `semaphore-net` and `semaphore-fake-server`, with
tests at all three levels (`core/tests/{w3.rs (the probe), w9_invite.rs, w9_receipts.rs, w9_media.rs,
w9_notifications.rs, w9_voice.rs}`, `net/tests/w9.rs`, `fake-server/tests/w9.rs` and the
account/route tests it extends). The owner's
decisions it implements are in "W6/W7 defaults" (third-party media, first run on the web) and
"W1/W4/W5 defaults"; nothing here needs a new backend route (the asks in "Backend asks W9" are
contract or engine gaps, with workarounds).

| Feature | Core (done) | HTTP / socket | Fake server |
|---|---|---|---|
| `needs_setup` on the connection probe | `Core::probe_server` reads `GET /onboarding/status`; a server that can't say keeps the probe's other answers | `HttpBackend::onboarding_controller_get_status` | `GET /api/onboarding/status`, control `onboarding` |
| Registration modes | `Core::register_requirements`; `Core::register` refuses locally on `CLOSED`, without a code on `INVITE_ONLY`, and sends none on `OPEN` | `CreateUserDto.code` stays a string (empty when open): the contract still requires it | `POST /api/users` honours `public_settings.registrationMode` or the instance settings; `CLOSED` is 403 "Registration is closed on this server" |
| Joining an invite as an existing account | `Core::accept_invite` → `InviteJoin` (joined; skipped with `InviteSkipReason`); the community list is read again after a join | `HttpBackend::invite_controller_accept_invite` | `POST /api/invite/{code}/accept` (one use, only when a community was joined); `seed_invite` takes `communityIds` |
| Invite preview's reason | `InvitePreviewView.reason` from a 404 with an `INVITE_*` code; it reads as `Ready` (an answer), not `Failed` | `invite_controller_get_public_invite` unchanged | `GET /api/invite/public/{code}` now 404s with `INVITE_NOT_FOUND`/`INVITE_EXPIRED`/`INVITE_EXHAUSTED`/`INVITE_DISABLED`, as the pinned backend does |
| Seen by (DMs and channels) | `Core::dm_peer_reads` (`DmPeerReadsView`), `Core::seen_by` (`SeenByView`, 15 names + `more`); `readReceiptUpdated` naming a peer moves their watermark directly | `HttpBackend::read_receipts_controller_get_{dm_peer_reads,message_readers}` | `GET /api/read-receipts/dm-peer-reads/{id}` (403 for a non-member), `GET /api/read-receipts/message/{id}/readers`, control `read_receipt` (also emits the DM event) |
| Third-party media setting | `Core::third_party_media`/`set_third_party_media`; `GifResultsView.needs_permission`; `LinkPreviewView.image_host`; `GifEmbed.host` (W7) | — (local setting, the host stores it) | — |
| Notification auto-mark on view | `State::w2_auto_read` on opening a channel or DM, when the centre's list arrives, and for a notification that arrives in the open conversation; one mark per notification, a failed one retried on the next visit | uses `notificationsControllerMarkAsRead` | — |
| Voice pre-join and join options | `Core::voice_prejoin` (`VoicePreJoinView`, `VoiceJoinMode`), `Core::join_voice_with` (`VoiceJoinOptions`); the engine is told before `connect` | uses the existing presence and capability reads | — |

### UI status, verified against the code (2026-11-12)

The status column above was written before the W1-W5 UI lanes and their app wiring landed, and
many rows that say "UI pending" are built and wired. A sweep of `semaphore-app` (every core command
the app never calls) and `semaphore-ui` (which views no screen reads) found these, and only these,
still missing; everything else in the inventory that has a core command is drawn and wired.

| Missing | UI | App |
|---|---|---|
| Instance admin, 8 pages | stubs only (`ui/src/admin/*`) | `/admin/*` routed to placeholders since the UI freeze |
| GIF picker | stub (`ui/src/gifs`) | `gifs`, `load_more_gifs` never called |
| GIF embeds, "Load" cards for GIFs and link-preview images | `MessageRow::gif`, `GifEmbed`, `GifResultsView.needs_permission` unread | the merged setting exists in the store (v3); no GIF fetch |
| Seen by | none | `seen_by`, `dm_peer_reads` never called |
| Voice pre-join | none | `voice_prejoin`, `join_voice_with` never called |
| Joining an invite as a signed-in account | preview only (`auth/invite.rs`) | `accept_invite` never called |
| Register form's mode | the form exists | `register_requirements` never called |
| Connect screen's "set it up in a browser" | none | `needs_setup` unread |
| Notifications page | the centre panel exists | `/notifications` was `Unbuilt` |
| `/friends`, `/profile`, `/community/create`, a channel's `/search` routes | the screens exist | were `Unbuilt` |
| Search paging | no "More" | one-shot `search_messages`; `search_results`/`load_more_search` unused |
| DM group: add people, leave | not offered | `add_dm_members`, `leave_dm` never called |
| The web's global shortcuts and the Mod+/ sheet | no sheet | only selection keys and Esc are bound |
| Replay trim preview | `TrimTimeline::preview` is a slot | the web plays the selection in `components/Voice/TrimPreview.tsx` (hls.js over `GET /livekit/replay/preview/playlist.m3u8`); native's player can't read the buffer's MPEG-TS segments yet: a later player lane (Claude) |
| Thumbnails (W7-T) | rows are sized from `width`/`height` | `files.rs` already fetches `/thumbnail` when `has_thumbnail` and the viewer `full_image`: only the proof is left (WT) |

The profile's friend button is already built (`FriendAction` Add / Pending / Friends, as the web).

### UI freeze and lanes (2026-11-12)

The UI freeze (on `native/ui-plan`) lets screens and their wiring be built in parallel:

- **Routes** (`ui/src/nav`): `Route::Admin { page }` (`/admin/debug` stays unbuilt),
  `Notifications`, `Friends`, `OwnProfile`, `CreateCommunity`, `ChannelSearch`, with nav tests.
  Until their lanes land they draw the placeholder these paths had before.
- **Frozen component APIs** (`new`, setters, an `Event` enum naming the command per event; a
  placeholder render): `admin::{layout::AdminShell, dashboard::DashboardPage,
  settings::InstanceSettingsPage, users::UsersPage, communities::CommunitiesPage,
  invites::InstanceInvitesPage, roles::InstanceRolesPage, storage::StoragePage}`,
  `gifs::GifPicker`, `voice::prejoin::PreJoinPanel`, `notifications::page::NotificationsPage`,
  `shortcuts::ShortcutSheet`; new events and setter stubs on existing components:
  `MessageListEvent::{EnableThirdPartyMedia, SeenByHovered}` with `MessageList::{set_third_party_media,
  set_seen_by, set_dm_peer_reads}`, `ComposerEvent::OpenGifs` with `Composer::set_gifs_enabled`,
  `SearchPanelEvent::More` with `SearchPanel::set_more`, `DmHeaderEvent::{AddPeople, Leave}` with
  `DmHeader::set_group_actions`, `AuthEvent::OpenInBrowser` with `AuthScreen::{set_setup_needed,
  set_register_requirements}`, `InviteScreen::set_join` (`InviteJoinState`).
- **App hub files**, each called once from `root.rs` (core events, navigation, content, overlays):
  `root/admin.rs` (WA), `root/media.rs` (WM), `root/u9.rs` (WU), `root/prejoin.rs` (WP), and the
  conversation pane's `conversation/media.rs` (WM) and `conversation/seen.rs` (WP).
- **More hooks**: `MediaSource::gif(url)` (a GIF from the GIF service, nothing unless the app
  allows it) and `GifPicker::set_media`; the account menu's Admin entry
  (`AppRoot::admin_account_action`); `u9_accept_invite` from the invite page's Accept (signed out it
  still registers), `u9_dm_header_updated` whenever the open DM's header gets its state, and
  `run_notification_event` (the centre's handler, shared with the page) in `root/inbox.rs`;
  `community_settings::common` is `pub(crate)` for the admin pages; the slice rig's condition hubs
  `rigs/slice/src/{w6, w7, w9, w9v}.rs` (`wait core w6 ..` etc., empty).
- **Review scripts** (empty): `rigs/shot/scripts/{ua1-admin-shell-settings, ua2-admin-dashboard,
  ua3-admin-users, ua4-admin-communities-invites, ua5-admin-roles-storage, ug-gif-picker,
  um-message-media, uv-voice-prejoin, us1-auth-extras, us2-inbox-items, uk-shortcut-sheet,
  wt-thumbnails}.steps`.

| Lane | Owns | Copies | Size | Built by |
|---|---|---|---|---|
| UA1 admin shell and settings | `ui/src/admin/{mod.rs, layout, settings}` | `community_settings/shell.rs`, `overview.rs` | M | DeepSeek (`lane-briefs/ua1-admin-shell-settings.md`) |
| UA2 dashboard | `ui/src/admin/dashboard` | new | S-M | Claude |
| UA3 users | `ui/src/admin/users` | `community_settings/members.rs`, `moderation/dialogs.rs` | L | DeepSeek (`ua3-admin-users.md`) |
| UA4 communities, invites | `ui/src/admin/{communities, invites}` | `community_settings/invites.rs` | M | DeepSeek (`ua4-admin-communities-invites.md`) |
| UA5 roles, storage | `ui/src/admin/{roles, storage}` | `roles/list.rs`, `roles/editor.rs` | M | DeepSeek (`ua5-admin-roles-storage.md`) |
| UG GIF picker | `ui/src/gifs`, the GIF button in `ui/src/composer` | `ui/src/emoji` grid, composer palette | M | DeepSeek (`ug-gif-picker.md`); moves to Claude if UA1/UA3 needed heavy fixes |
| UM message media, seen-by | `ui/src/messages/*`, the switch label in `ui/src/settings/desktop.rs` | — | M | Claude |
| UV voice pre-join | `ui/src/voice/prejoin.rs` | — | S-M | Claude |
| US1 auth extras | `ui/src/auth/{mod.rs, register.rs, invite.rs}` | edits | S-M | DeepSeek (`us1-auth-extras.md`) |
| US2 inbox items | `ui/src/notifications/page.rs`, `ui/src/dms/{mod.rs, header.rs}`, `ui/src/panel/{mod.rs, search.rs}` | `notifications/center.rs`, `dms/picker.rs` | M | DeepSeek (`us2-inbox-items.md`) |
| UK shortcut sheet | `ui/src/shortcuts` | — | S | DeepSeek (`uk-shortcut-sheet.md`) |
| WA admin wiring | `app/src/root/admin.rs`, `rigs/slice/scripts/w6.steps` | `root/community.rs` | M-L | DeepSeek (`wa-admin-wiring.md`) |
| WM media wiring | `app/src/root/media.rs`, `app/src/conversation/media.rs`, `app/src/files.rs`, `rigs/slice/scripts/w7.steps` | — | M | Claude |
| WU U9 wiring | `app/src/root/u9.rs`, `app/src/conversation/side.rs`, `rigs/slice/scripts/w9.steps` | `root/inbox.rs` | M-L | DeepSeek (`wu-u9-wiring.md`) |
| WP pre-join, seen-by wiring | `app/src/root/prejoin.rs`, `app/src/conversation/seen.rs`, `rigs/slice/scripts/voice-w9.steps` | `root/calls.rs` | S-M | Claude |
| WT thumbnails proof | stories in `ui/src/messages/stories.rs` (after UM), `rigs/slice/scripts/w7-thumbs.steps` | — | S | DeepSeek (`wt-thumbnails-proof.md`) |

Order: the freeze; then UA1, UA3 (DeepSeek, at most two at once on the Ollama plan) with UA2, UM
(Claude); then UA4, UA5 with UV; then US1, US2, then UG, UK; then the wiring (WA and WU need their
screens, WM needs UG and UM, WP needs UV and UM); then WT. Every DeepSeek UI lane gets a Claude
screenshot review of its review script (desktop and phone, against the web page and the copied
screen) and a diff review against its brief; a lane that fails once is redone by Claude.

**UI defaults (chosen with the owner, 2026-11-12):**

- GIFs and animated images autoplay in the list once third-party media is on, as on the web;
  reduced motion shows the first frame only; WM's frame and pixel budget lands before autoplay.
- Shortcuts: the web's set only.
- Admin pages are a route in the main window, like community settings; the phone drills in.
- The pre-join replaces click-to-join on voice channels everywhere, as on the web.
- "Seen by" shows on my own latest message, on hover.
- A DM group can be left; a one-to-one DM doesn't offer "Add people".
- Search paging replaces the one-shot search.
- An unknown `INVITE_*` reason shows the server's message.
- The quota dialog takes GiB and sends bytes.

**Later platform lanes** (outside these waves): the application menu with About (Electron has
one: `electron/main.ts` `setupApplicationMenu`), the app version shown, the replay trim preview
(the player reading HLS / MPEG-TS), screen-share volume (a per-track gain in the engine), voice
isolation (no libwebrtc counterpart). Packaging, auto-update and installers are the packaging lane's.

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
| W4-media | Soundboard on its own published `soundboard` track (`MediaEngine::play_soundboard`, decoding chosen by this unit; the default build works without the player feature), the VAD threshold applied (devices, processing, PTT and the mic preset are applied since W3-app), device test loopback and level meter (`LiveKitEngine::start_input_test`), participant volume through `MediaEngine::set_participant_volume`, `MediaEngine::diagnostics`, `LocalMediaView::{may_speak, screen_tracks}` in reports, keep-awake during calls (`keep_awake.rs`: logind inhibitor / `SetThreadExecutionState`) | `semaphore-media-livekit`, `semaphore-platform-desktop` (`keep_awake.rs` only) | W0-settings | M | engine tests with `testing.rs` fakes; `slice-e2e.sh --voice` still green |
| W4-ui-voice | Incoming call banner, DM call controls, participant context menu (volume, moderator mute/remove), soundboard button, float card and dock zones, voice debug panel | `ui/src/voice` | W4 freeze | L | stories: each state, moderator vs member, phone |
| W4-ui-replay | Capture modal, trim timeline, clip library, share dialog | new `ui/src/replay` | W4 freeze, W3-player | M | stories: empty library, long clip, capture failure |
| W4-av-publish (placeholder) | Camera publish, screen share publish with quality, source picker, screen audio | designed separately | separate design | L | defined by that design |
| W4-app | Wire DM calls, soundboard, moderator actions, replay, debug panel | `semaphore-app/src/{voice,root}.rs`, `rigs/slice/scripts/voice-w4.steps` | W4-core, W4-media, W4-ui-* | M | `slice-e2e.sh --voice` with the new steps: DM call between rig and publisher, soundboard play, server mute, capture a clip |

**W4 freeze** (2026-11-11). Two changes to the table above: join, leave and ring sounds are
decided by core (`CoreEvent::Sound { cue: SoundCue }`) and played by W4-app (`sounds.rs` with the
web's WAV files), not W4-media; and W4-media's remaining scope is the row as written above. After the
freeze, each lane owns these files:

| Lane | Owns |
|---|---|
| W4-core | `semaphore-core/src/{commands/{calls,voice,soundboard,replay,diagnostics}.rs, events.rs, client.rs (effects), backend/*}`, `semaphore-net/src/backend/{voice,replay,soundboard,moderation}.rs`, `semaphore-core/tests/{w4.rs, w4_wire.rs, common/w4.rs, media.rs}`, the bodies in `semaphore-ffi/src/voice_w4.rs`. Model changes only additive, with the coordinator |
| W4-fake | `semaphore-fake-server/src/http/{voice.rs, replay.rs (new), soundboard.rs (new)}`, new `src/calls.rs` (DM presence, replay state), control arms in `http/mod.rs`, fixture sounds, clips and segments |
| W4-media | `semaphore-media-livekit/src/{engine.rs, input_test.rs, soundboard.rs (new), audio/*}`, `semaphore-platform-desktop/src/keep_awake.rs` |
| W4-ui-voice | `semaphore-ui/src/voice/*` (new `incoming.rs`, `menu.rs`, `soundboard.rs`, `debug.rs`, `dock.rs`) |
| W4-ui-replay | `semaphore-ui/src/replay/*` |
| W4-app | `semaphore-app/src/{voice,root,sounds,services}.rs`, sound assets, `rigs/slice/scripts/voice-w4.steps` |

**W4-media owes core the share's track ids.** The replay buffer starts from
`LocalMediaView::screen_tracks` in the engine's reports, and the LiveKit engine reports `None`
there today (`semaphore-media-livekit/src/engine.rs`, `local_media`). Until it fills the published
screen share's video sid (and its audio sid once that track is published), no replay buffer starts
on desktop. Core waits `REPLAY_AUDIO_WAIT_MS` (2 s) for a share's audio track, as the web does; the
host calls `Core::expire_replay_audio_wait` at `VoiceView::replay_audio_wait_until_ms`, and an
engine report of `screen_audio: Failed` starts the video alone at once.

**W4 defaults** (chosen for the owner, who may overrule; 2026-11-11):

- Declining an incoming call tells the server (it has carried `dmVoiceCallDeclined` and the
  `POST /dm-groups/{id}/voice-presence/decline` route since the 2026-11-12 repin), best-effort: the
  ring stops here at once, and a 1:1 caller's call ends when it hears the decline. A group DM keeps
  going.
- The replay buffer starts by itself when a screen share is published in a channel call, and stops
  with the share or the call, as on the web. Never in a DM call.
- The voice participant menu offers "Kick" (removal from the community) behind a simple confirm in
  W4; W5's moderation dialogs replace it later.
- Group DM calls ring every member.
- No automatic leave when alone in a DM call.
- One ring at a time, the newest wins; a ring lasts 30 s and also stops when the call is answered on
  another of my devices or the caller gives up (its presence empties). The web does neither.
- Keep-awake holds off system sleep only, not the display (Electron's `prevent-app-suspension`).
- Soundboard sounds go out on a separate `soundboard` track, as on the web, not mixed into the mic:
  the mic's mute, push to talk and server mute don't hold them back.
- Participant volume goes through the `MediaEngine` trait, so a mobile engine can take it.
- Join failures are classified and kept for the debug panel only: nothing is reported until the
  backend accepts a native platform.

### Wave 5: community administration and moderation

**Done** (2026-11-12): core, the three screen groups and the app wiring (`w5.steps`) are on `spike/native-gpui`.

| Unit | Delivers | Touches | Depends on | Size | Done when |
|---|---|---|---|---|---|
| W5-core | Community update/delete, channel CRUD and reorder, private channel membership, roles CRUD/assign, channel permission overrides, community/instance permission set for gating, alias groups, custom emoji, soundboard, webhooks, invites management, ban/kick/timeout, ban/timeout lists, moderation log | core lane files, net, fake server | W4-core | L (split in two with W0-seams) | core tests per command; permission-set gating tests |
| W5-ui-community | Community settings shell and tabs: overview, members, channels, private channels, mention groups, emoji, soundboard, webhooks, invites | new `ui/src/community_settings` | W5 freeze | L | stories per tab with empty/long/error and permission variants |
| W5-ui-roles | Role list, role editor (permission matrix), assignment dialog, channel permission overrides | new `ui/src/roles` | W5 freeze | M | stories: many roles, owner vs admin, phone |
| W5-ui-moderation | Ban/kick/timeout dialogs, user moderation menu, ban and timeout lists, moderation log | new `ui/src/moderation` | W5 freeze | M | stories per dialog and list state |
| W5-app | Wire community settings route, role-gated actions across the shell | `semaphore-app/*`, `rigs/slice/scripts/w5.steps` | W5-core, W5-ui-* | M | `w5.steps`: create channel, edit role, timeout a member (composer locks), ban, invite created |

**W5 freeze** (2026-11-11). W5-core runs as two full-stack lanes, each owning core, net and fake
server for its area, so each proves its own wire tests. If W5-B is too big, its fake-server files
can go to a separate W5-fake-B lane. The shared core files (`cache.rs`, `commands/mod.rs`,
`commands/queries.rs`, `events.rs`, `client.rs`) only call each lane's hub, so neither lane edits
them: `CacheValue::W5a`/`W5b` hold the lanes' own value enums, and `view_for`, `key_for`, the
`query_changed` arm, the fetch arm and `apply_event` delegate to `community_admin.rs` (A) and
`moderation.rs` (B). The fake server's `Scenario::extra` holds the scenario's other top-level keys
for the lanes to read. After the freeze, each lane owns these files:

| Lane | Owns |
|---|---|
| W5-A structure: community update/delete, channels CRUD and moves, private channel members, adding members, mention groups, custom emoji, sound management, webhooks, invites | `semaphore-core/src/commands/{community_admin,community_assets}.rs`, `semaphore-core/src/backend/community_admin.rs`, `semaphore-net/src/backend/community_admin.rs`, `semaphore-fake-server/src/{admin.rs, http/community_admin.rs, http/communities.rs}`, `semaphore-core/tests/{w5a.rs, common/w5a.rs}`, `semaphore-net/tests/w5a.rs`, the bodies in `semaphore-ffi/src/admin_w5a.rs`, its scenario keys |
| W5-B RBAC: the community permission set, roles and assignment, channel overrides, ban/unban, timeouts, lists, the moderation log, being moderated | `semaphore-core/src/commands/{roles,permissions,moderation}.rs`, `semaphore-core/src/backend/{roles,moderation}.rs`, `semaphore-net/src/backend/{roles,moderation}.rs`, `semaphore-fake-server/src/{rbac.rs, actions.rs (role routes), http/{roles,moderation}.rs}`, `semaphore-core/tests/{w5b.rs, common/w5b.rs}`, `semaphore-net/tests/w5b.rs`, the bodies in `semaphore-ffi/src/admin_w5b.rs`, `rolesByCommunity` and its other scenario keys |
| W5-ui-community | `semaphore-ui/src/community_settings/*` |
| W5-ui-roles | `semaphore-ui/src/roles/*` |
| W5-ui-moderation | `semaphore-ui/src/moderation/*` (and the removal dialog) |
| W5-app | `semaphore-app/*`, the `CommunityRemoved`/`ChannelRemoved` arms in `semaphore-ui/src/shell/mod.rs`, `rigs/slice/scripts/w5.steps` |

Model changes after the freeze are additive only, with the coordinator. A's fake handlers ask
`rbac::allows`, which B fills in (true until then). The Members tab's per-member actions read B's
`Core::moderation_target`.

**W5 defaults** (chosen for the owner, who may overrule; 2026-11-11):

- "Remove" on the Members tab is the moderation kick (KICK_USER, with a reason, logged), W4's
  `Core::kick_member`; the plain membership removal (DELETE_MEMBER) isn't offered.
- An action the rank rule forbids shows disabled with its reason (`NotAllowed`), not hidden.
- The instance owner without a role in the community gets what the server gives them today: ban,
  kick and timeout show refused (`NotAllowed::Rank`), because the server applies the rank rule to
  them (see Backend asks W5). The gating flips when the server changes.
- Being kicked or banned, or the community being deleted, shows one dialog ("You were removed
  from X" / "You were banned from X", with the reason and, for a temporary ban, until when), then
  goes home. Core leaves the call and drops the community first (`CoreEvent::CommunityRemoved`).
- When a timeout runs out, the host calls `Core::timeout_elapsed` at `timed_out_until_ms`: the
  server says nothing then.
- The Invites tab lists only my invites that include this community (the web lists all of mine),
  and offers creating one only with community CREATE_INVITE and instance CREATE_INSTANCE_INVITE,
  both of which the server asks for.
- "Add member" searches with `userControllerSearchUsers` and the community, not the web's admin-only
  user list.
- Reset default roles is offered, behind a confirm.
- Per-member channel overrides (`OverwriteTarget.MEMBER`) are left out: the API doesn't manage
  them.
- Role actions are wire names, and a saved role keeps the ones this build doesn't know.

**Carried over** (for whoever touches core next):

- A ring stopped early once in a wave 4 rig run; the suspected cause was a late, empty DM-presence
  answer from the previous ring. W5-B didn't reproduce it: `w4_ring` marks a presence read
  already out as dirty, so its answer can't end the new ring. `semaphore-core/tests/w4.rs`
  `a_late_empty_presence_from_the_previous_ring_does_not_end_the_next_one` (the read held while a
  reconnect re-reads it and the caller calls again) and `a_late_leave_of_the_previous_call_...`
  pass without a change. Still open: a direct `dmVoiceUserLeft` for another member applied to a
  cached presence that a dirty (old) answer just wrote, in a group DM. Next step if it recurs:
  the rig's event log around the ring.

**W5-B notes** (2026-11-11):

- The fake server's permission model is `semaphore-fake-server/src/rbac.rs`: `allows`, `guard`,
  `is_member`, `add_member` (gives the Member role), `remove_member`, `is_banned`,
  `timed_out_until`, `roles_of`, `members`, `community_of_channel`. Lock order: `accounts`, then
  `rbac`; never `rbac` with `data`, `admin` or `calls`. Tests set ranks with `FakeServer::act_as`
  (control `act_as`) and sign in as another scenario user with `FakeServer::sign_in_as` (control
  `sign_in_as`). Role ids are served as UUIDs in UUID scenarios (`rbac::role_uuid`).
- Kick now needs the KICK_USER guard and the rank rule, as the backend has it; the W4 tests that
  kick give `me` the Community Admin role first.
- Routes under `/api/channels/{...}` must name the segment `{channelId}`: axum refuses two
  different names at the same place.
- Membership in the fake: W5-A's member list should ask `rbac::is_member` / `roles_of` so bans,
  kicks and role changes show there.
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
| W7-thumbnails | Server-sized thumbnails (U12) so image boxes size correctly | `backend/` (U12, API-contract stack), core, `ui/src/messages` | U12 landed in the `fd19adce` repin | S | core test on dimensions (done: `AttachmentView` takes them from the DTO); story shot with mixed aspect ratios |
| W7-preview-images | Link-preview images per Mike's decision (direct fetch with the existing limits, or a server proxy) | `semaphore-app/src/files.rs`, possibly `backend/` | Mike's decision | S | `slice-e2e.sh` link-preview step flips from "unrequested" to drawn |

### W6/W7 freeze

Landed on `native/w6-core` (2026-11-12) in three commits: a mechanical contract repin, the seam
and model freeze, and these docs. First run is **not** built natively (owner decision below), so
W6-onboarding and the setup lanes are gone; W7-preview-images was already done in W3 (the app's
`PreviewFetcher` behind a setting) and is folded into W7-app.

The shared core files only call two hubs: `commands/instance_admin/mod.rs` (W6, which calls one
file per lane: `instance.rs`, `users.rs`, `storage.rs`, `content.rs`, `roles.rs`) and
`commands/gifs.rs` (W7-A). `CacheValue::W6(W6Value::<Lane>(..))`/`CacheValue::W7`, `State.w6`/`w7`,
`view_for`, `key_for`, `query_changed`, the fetch arm, `apply_event` and the reconnect keys all
delegate there. Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`,
`w5a_begin`, `w5a_settle`, `w5a_op`, `w5a_refuse`, `AdminOp::finished`). The freeze fills two things
itself: `InstancePermissionsView::admin` (`InstanceAdminCaps`, from my instance roles; the owner gets
everything) and `ServerInfo::gif_search`. The fake server has one state module and lock per lane
(`src/w6/*.rs`, `src/gifs.rs`) and `crate::w6::allows(inner, user, action)` for instance guards
(the owner only until W6-E adds assigned instance roles). Briefs for the spelled-out lanes:
`docs/lane-briefs/`.

| Lane | Owns (besides its freeze stubs) | Depends on | Size | Who |
|---|---|---|---|---|
| W6-A instance | `core/src/commands/instance_admin/instance.rs`, `core/src/backend/instance_admin.rs`, `net/src/backend/instance_admin.rs`, `fake-server/src/{http/instance_admin.rs, w6/instance.rs}`, `core/tests/{w6_instance.rs, common/w6_instance.rs}`, `net/tests/w6_instance.rs`, `fake-server/tests/w6_instance.rs` | freeze | S-M | DeepSeek: `lane-briefs/w6-a-instance.md` |
| W6-B users | the same set named `users` / `admin_users` / `w6_users` (the fake's ban, password and delete use `accounts.rs`'s existing session methods; the owner role goes through `Accounts::users`) | freeze | M | DeepSeek: `w6-b-users.md` |
| W6-C storage | the same set named `storage` / `admin_storage` / `w6_storage` | freeze | S | DeepSeek: `w6-c-storage.md` |
| W6-D content | the same set named `content` / `admin_content` / `w6_content` | freeze | M | DeepSeek: `w6-d-content.md` |
| W6-E instance roles | the same set named `roles` / `instance_roles` / `w6_roles` (the fake's `w6/roles.rs` also answers `GET /roles/my/instance` and `GET /roles/user/{id}/instance`, and serves instance role assignment for W6-B) | freeze | S-M | DeepSeek: `w6-e-roles.md` |
| W7-A gifs core | `core/src/{commands/gifs.rs, text/gif.rs, backend/gifs.rs}`, the `MessageRow::gif` fill in `core/src/store.rs` and `scenario.rs` (one line each), `net/src/backend/gifs.rs`, `fake-server/src/{http/gifs.rs, gifs.rs}`, `core/tests/{w7_gifs.rs, common/w7_gifs.rs}`, `net/tests/w7_gifs.rs`, `fake-server/tests/w7_gifs.rs` | freeze | S-M | DeepSeek: `w7-a-gifs.md` |
| W7-thumbnails | core fills `AttachmentView::{width,height}`; `ui/src/messages` sizing | backend #715, then a repin | S | blocked |
| W6-ui-shell | `ui/src/admin/{mod.rs, layout, dashboard, settings}` | freeze | M | Claude |
| W6-ui-users | `ui/src/admin/users/*` | freeze | L | Claude |
| W6-ui-content | `ui/src/admin/{communities, invites}/*` | freeze | M | Claude |
| W6-ui-roles-storage | `ui/src/admin/{roles, storage}/*` (may use `ui/src/roles` widgets, never edit them) | freeze | M | Claude |
| W7-ui-gifs | `ui/src/gifs/*`, the GIF button in `ui/src/composer` | freeze | M | Claude |
| W7-ui-embed | `ui/src/messages/*`: the GIF embed and its "Load" card | freeze | S | Claude |
| W6-app | `semaphore-app/*` admin route and the "set up in a browser" connect notice (probe reads `onboarding_controller_get_status` into `ServerInfo::needs_setup`), `rigs/slice/scripts/w6.steps` | W6 lanes | M | Claude |
| W7-app | `semaphore-app/{files.rs, settings.rs, conversation.rs}`: the merged third-party media setting (migrated from `link_preview_images`), GIF fetches through `PreviewFetcher`, a frame limit for animated images; `w7.steps` | W7-A, W7-ui-* | M | Claude |

At most three UI lanes at once: shell, users, content; then roles-storage, gifs, embed.
Left for W6-app: `AdminUserRolesView::available` (it joins W6-B's user roles with W6-E's roles list,
built in parallel).

**Contract has it, core doesn't use it yet** (after the repin to `fd19adce`, 2026-11-12, which
wired the channel capability flags, `deleteMessage`'s `removal`, `DM_BLOCKED`, search paging, the
notifications list's `includeDismissed` and its rows' `channelName`/`parentMessageId`, the
nullable DND window, and attachment `width`/`height`): `ErrorCode::CURRENT_SESSION_UNKNOWN` (the
web has no special handling for it either: the sessions commands already treat a refusal as "not
signed out"); `VoiceClientPlatform::native` (join failures stay local until the backend accepts a
native platform); `timeoutRemoved.expired`, which changes no decision (a timeout that ran out and
one a moderator lifted unlock the composer and read the same lists again), so nothing branches on
it; `ChannelVoicePresenceUserDto.canModerate`, which the presence list keeps for a later "remove
from this call" menu that core doesn't offer; the new events `dmGroupCreated`,
`dmGroupMemberAdded`/`dmGroupMemberLeft`, the five `friend*` ones, `instanceRolesUpdated`,
`notificationDismissed` and `notificationsRead` (each ignored in `core/src/events.rs`, where the
comment says which list is read again instead); the invite list's `communityId` filter;
`POST /api/livekit/channels/{channelId}/remove-participant` (W4's Kick stays the community kick);
and the file DTOs' `width`/`height`, which the message's attachments already carry. W9 now uses
`POST /api/invite/{code}/accept` (`Core::accept_invite`) and the `INVITE_*` error codes (an invite
preview's `reason`). Another repin follows when the open backend PRs land.

**W6/W7 defaults** (chosen with the owner, 2026-11-11/12):

- The admin debug page (event injection) isn't built natively.
- Per-user storage quota editing is included (the web has none).
- The Admin entry shows for anyone holding any admin permission (the web: the owner or
  READ_INSTANCE_INVITE).
- Third-party media: no server proxy. One setting, "Load images from other sites (link previews,
  GIFs)", off by default and migrated from `link_preview_images`. The first time such media appears
  the user can press Enable, and it stays on. While off, the GIF picker shows a one-click "Allow"
  notice instead of the grid, and a received GIF is a "GIF from <host>: Load" card. The web loads all
  of these straight from the third party.
- First run isn't built natively: setup happens on the web. The connection probe learns
  `needs_setup` from `GET /onboarding/status`, and the connect screen says the server needs to be set
  up in a browser, with its web address to open.
- The instance owner bypasses RBAC for administration and moderation; privacy boundaries (DMs)
  stay.
- Instance invites are their own query (`inviteControllerGetInvites.admin`), apart from W5-A's
  per-community list, so the two never edit each other's cache.

### Wave summary

| Wave | Units (parallel) | Then |
|---|---|---|
| 0 | W0-contract, W0-seams, W0-e2e-multi, W0-settings | W0-real-smoke |
| 1 | W1-core; W1-ui-actions, W1-ui-emoji, W1-ui-composer, W1-ui-panels (3 at once) | W1-app |
| 2 | W2-core, W2-desktop; W2-ui-dms, W2-ui-friends, W2-ui-notifications; W1-app | W2-app |
| 3 | W3-core, W3-player; W3-ui-profile, W3-ui-settings, W3-ui-auth; W2-app | W3-app |
| 4 | W4-core, W4-media, W4-av-publish; W4-ui-voice, W4-ui-replay; W3-app | W4-app |
| 5 | W5-core; W5-ui-community, W5-ui-roles, W5-ui-moderation; W4-app | W5-app |
| 6 | W6-A to W6-E; W6-ui-shell, W6-ui-users, W6-ui-content, W6-ui-roles-storage (3 at once) | W6-app |
| 7 | W7-A; W7-ui-gifs, W7-ui-embed; W7-thumbnails when #715 lands | W7-app |

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

| Ask | Why | Native's workaround meanwhile | Issue |
|---|---|---|---|
| `pin`, `deleteAny` and `seeRemoved` flags on `ChannelCapabilitiesDto` | The web decides pin and moderator delete from RBAC actions (`useCanPerformAction`); native already reads channel capabilities for everything else | Reads `rolesControllerGetMyRolesForChannel` and checks the role actions | #639 |
| Say soft or hard in the `deleteMessage` payload | A moderator's soft removal and a hard delete send the same payload, so a client can't tell whether moderators should keep the row | A reader with DELETE_ANY_MESSAGE refetches `GET /messages/{id}`: a removed row stays, a 404 goes | #640 |
| A specific `ErrorCode` for a blocked 1:1 DM | `assertNotBlockedInDm` throws a plain FORBIDDEN ("You cannot message this user") for sends, thread replies and edits | Shows the server's message; the composer can't lock itself | #641 |
| A block check on reactions in 1:1 DMs | `reactions.service` has none, so a blocked user can still react | none (server gap) | #642 |
| Paging for message search | `search/{channel,group,community}` take `q` and `limit` only, newest first | Asks for one page; the UI says when results stop at the limit | #643 |
| Effective per-channel capabilities for pin, unpin, delete-any and see-removed | `rolesControllerGetMyRolesForChannel` returns community roles without the channel's permission overwrites, so a channel that denies or grants these is shown wrong (the web client has the same gap) | Uses the community roles, as the web does; the server still refuses what it denies | #644 |

### Asks from W2 for the backend lane

Found while building W2-core (2026-11-11). None blocks W2; each has a workaround in core.

| Ask | Why | Native's workaround meanwhile | Issue |
|---|---|---|---|
| Socket events for friendship changes (request sent, accepted, declined, cancelled, removed) | `friends` emits nothing at all, so a client learns of a request only by asking | Reads friends again after its own changes, on reconnect, and when shown while older than 30 s | #645 |
| Socket events for DM group changes (created, member added, member left) | `dm-group.*` are internal EventEmitter events only; other members see a new group at its first message | A message for a group the list lacks reads the list again | #646 |
| `notificationRead` (or a count event) for read-all, dismiss and the context reads `markAsRead` does | Only a single mark-read is announced, so other devices' badges stay stale | Reads the count again after its own changes and its own `readReceiptUpdated` | #647 |
| Leave dismissed rows out of `GET /notifications` (or a filter) | The list returns them, and `total` counts them, so paging and "more" include rows nobody shows | Filters them out; "more" compares raw rows to `total` | #648 |
| `channelName` on list rows, `parentMessageId` on `newNotification` | The list DTO lacks the name the event has; the event lacks the thread the list has | Takes names from cached channels; a thread reply's OS notification opens the channel | #649 |
| A JSON `null` for "no override" from `GET /notifications/channels/{id}/override` | It answers 200 with an empty body, which the generated client can't decode | A hand-written request for that one call | #650 |
| A way to clear a DND time in `UpdateNotificationSettingsDto` that the contract can express | Clearing needs an explicit `null`, which the generated optional field can't send | A hand-written body for settings saves | #651 |

### Asks from W3 for the backend lane

Found while building W3-core (2026-11-11). None blocks W3; each has a workaround in core or a product
decision.

| Ask | Why | Native's workaround meanwhile | Issue |
|---|---|---|---|
| Honour `registrationMode` in `POST /users` | `createUser` demands a valid invite code whatever the mode: `OPEN` still refuses a sign-up without one, and `CLOSED` still accepts a valid one. The web's register page doesn't read the mode either | Follows the advertised mode: Register hidden when `CLOSED`, an invite code asked for otherwise | #652 |
| An endpoint for a signed-in user to accept an instance invite (join its default communities) | `/join/:code` only creates a new account (`register` with the code); an existing account can't use an invite | Signed in, `register` refuses with a message saying the account exists and the invite can't be applied from here | #589 |
| `GET /invite/public/{code}`: a JSON `null` (or a 404 with a reason) for a code it won't honour | It answers 200 with an empty body, the same for unknown, expired, used up and disabled, which the generated client can't decode and nobody can tell apart | Reads an empty answer as "can't be used", with no reason | #653 |
| An instance-role change event for the user (or `roleAssigned`/`roleUpdated` covering instance roles) | `GET /roles/my/instance` decides "Create community"; nothing says when it changes | Read when shown, again on a new connection | #654 |
| `revokeAllOtherSessions` naming the reason when it can't tell the current session | It answers 401 "Could not determine current session", the code a client takes for a lost session | Core doesn't sign out on a 401 from that call; the slice's real-backend step 10 proves the app's own session survives | #655 |
| An idle or away status other users can see | Presence is a boolean; `presenceOnline { idle }` only stops push | Sends idle; shows nobody as idle | #656 |
| Parse `unreadOnly` as a boolean on `GET /notifications` | Any value, `false` included, is read as true, so `unreadOnly=false` returns only unread rows | Never sends the parameter (`unread_only` only as `Some(true)`) | #657 |
| `total` on `GET /notifications` that counts the list | It is the size of the page sent, so a client can't page by it | A full page means "more may follow" | #658 |

### Backend asks W4

Found while designing W4 (2026-11-11). None blocks W4; each has a workaround or a default above.

| Ask | Why | Native's workaround meanwhile |
|---|---|---|
| Put `TrackSource.UNKNOWN` (the soundboard's source) in `publishGrantFor`'s `canPublishSources` | Whenever the grant lists sources (no VIDEO or SCREEN_SHARE permission, server-muted, timed out), the `soundboard` track is refused. The web has the same failure | Shows the engine's refusal as the play's error |
| A permission (and a rate limit) for playing soundboard sounds | `READ_SOUNDBOARD_SOUND` gates the list only; anyone who may publish can play, as often as they like | none (server gap) |
| A native value in `ReportJoinFailureDto.platform` | `VOICE_CLIENT_PLATFORMS` is `web` and `electron` only | Join failures stay local, in the debug panel |
| Decline, missed-call or cancel events for DM calls, and a REST leave for DM voice presence | `dmVoiceCallDeclined`/`dmVoiceCallEnded` and `POST /voice-presence/decline` exist since the 2026-11-12 repin; there are still no missed-call or cancel events, and DM presence leaves only by LiveKit's webhook or the 90 s TTL | Decline goes through the REST route (best-effort); a 1:1 caller's call ends on `dmVoiceCallDeclined`; ringing also stops when the call's presence empties |
| Make the "first user" check in `handleWebhookDmParticipantJoined` atomic | `smembers` then a pipeline: two members joining at once can both emit `dmVoiceCallStarted` | A ring for a DM whose call we're in or joining is ignored |
| A "remove from call" endpoint, and whether I outrank someone | The web's voice "remove" is a community kick; server mute needs outranking, which a client can't see | Kick behind a confirm; the menu offers mute by role and shows the server's 403 |

### Backend asks W5

Found while designing W5 (2026-11-11). None blocks W5; each has a workaround or a default above.
Issues: #679 to #688, plus those named.

| Ask | Where | Affects the web today | Native's workaround meanwhile |
|---|---|---|---|
| Let the instance owner past the rank rule of ban, kick and timeout, as unban, lifting a timeout and membership removal already do (`membership.service.ts:389`); the controller doesn't pass the role (#679) | `backend/src/moderation/moderation.service.ts:78-97` (`canModerate`), `:136`, `:357`, `:471`; `moderation.controller.ts:75-81`, `:146` | Yes: an owner with no role in the community is refused | Shows those actions refused (`NotAllowed::Rank`) |
| Invalidate the member list under its real key after ban, kick and timeout: the handlers name `membershipControllerGetMembers`, which isn't an operation (#680) | `frontend/src/socket-hub/handlers/moderationHandlers.ts:9,18,26,37` (frontend) | Yes: member lists stay stale | Core also reads `membershipControllerFindAllForCommunity` again |
| A socket event to the user added to or removed from a private channel (#681) | `backend/src/channel-membership/channel-membership.service.ts:102,290` (internal room events only); `rooms/room-subscription.handler.ts:365-407` | Yes: the channel appears or goes only on a refetch | Reads channels again when shown and on a new connection |
| Socket events for custom emoji, soundboard, mention group and webhook changes (#682) | `custom-emoji/` and `soundboard/` services emit none; `alias-groups/alias-groups.service.ts:213,315,374,404,476` (room events only) | Yes: pickers and lists stay stale | W2's rule: read again after own changes, when shown and older than 30 s, on reconnect |
| An event for an unban, and something that tells moderators to refresh the ban list, timeout list and moderation log (#683) | `backend/src/moderation/moderation.service.ts` (`unbanUser`) | Yes (low) | Reads those lists again on any moderation event it sees, and when shown |
| An event when a timeout runs out by itself (only the voice-restore job runs then) (#684) | `backend/src/moderation/moderation.service.ts:551-560` | Probably: the web composer only ticks locally (`frontend/src/hooks/useComposerAvailability.ts:83`); whether its capabilities stay masked until a refetch isn't checked | `Core::timeout_elapsed` at `timed_out_until_ms` |
| Community invites: decide whether community CREATE_INVITE alone should do (today instance CREATE_INSTANCE_INVITE is also required, so the default Community Admin can't invite); list invites per community (`GET /invite` returns all of mine); delete says admins bypass but only the creator may (#685) | `backend/src/invite/invite.controller.ts:32,49`; `invite.service.ts:42-62,200-203,273-276`; web `components/Community/InviteManagement.tsx:63,76` | Yes | Gates on both actions; filters to the community |
| "Add member" lists users through instance READ_USER, so community admins without an instance role are refused (#686) | `frontend/src/components/Community/MemberManagement.tsx:62` (frontend); `backend/src/user/user.controller.ts:118-121` | Yes | Uses `userControllerSearchUsers` with the community |
| An enum for the moderation log's `action` filter in the contract (it is a free string) (#687) | `backend/src/moderation/moderation.controller.ts:340` | No | Sends the wire name |
| Timeout list behind VIEW_BAN_LIST: a moderator with only TIMEOUT_USER can't see it (product) (#688) | `backend/src/moderation/moderation.controller.ts:211` | Yes | Gates the list on VIEW_BAN_LIST |
| A banned or kicked user can hear the event twice (personal room, then the community room after a room leave that isn't awaited) | `backend/src/moderation/moderation.service.ts:209-230,398-420` | No (invalidation is idempotent) | Core announces a removal once. #673 |
| Channel capabilities for update, delete and webhooks; overrides in the role lookup; whether I outrank someone | `ChannelCapabilitiesDto`, `rolesControllerGetMyRolesForChannel` | Yes | Community roles, as the web does. #639, #644, #663 |
| Grant-only-held checks a role update's whole action list, not what it adds: a role below you that holds one action you lack can't be saved at all, and the default Moderator can't assign the Member role (Member holds ATTACH_FILES, SPEAK, VIDEO, SCREEN_SHARE, which Moderator doesn't) | `backend/src/roles/community-roles.service.ts:895` (`assertHolds(st, updateRoleDto.actions)`), and `assertHolds(st, role.actions)` in `assignRoleAsActor` | Yes: the save or assignment is refused | `RoleRow::editable`/`assignable` are false then |
| Reordering sets positions 10, 20, ...: with ten or more roles besides Member, the tenth ties Member at 100 and later ones rank below it | `backend/src/roles/community-roles.service.ts:683` | Yes | none |
| The default Community Admin role has UNBAN_USER but not BAN_USER (product?) | `backend/src/roles/default-roles.config.ts:188-269` | Yes: community admins can't ban by default | none |
| The web role editor leaves CAPTURE_REPLAY out of every permission group, so it can't be granted there | `frontend/src/constants/rbacActions.ts:114-200` (frontend) | Yes | Native's catalog puts it under voice |

### Backend asks W6

Found while designing W6 and W7 (2026-11-11).

| Ask | Where | Affects the web | State |
|---|---|---|---|
| `READ_ALL_COMMUNITIES` is in no role and can't be put in an instance role (valid instance actions are the Instance Admin role's 12), so only owners reach the admin Communities page or force-delete; the Community Creator role can't be created or edited through the API | `backend/src/roles/default-roles.config.ts`, `roles/instance-roles.service.ts`, `community/community.controller.ts` | Yes | #706, open: needs a decision. Native gates on the action, so in practice owners only |
| Force-delete emits no `communityDeleted`; setup stored the instance name where nothing reads it; a setup race could make two owners; setup's username and password rules; instance role delete had no actor check; instance settings bounds differed from storage settings; GIF `limit` unbounded; `vapidPrivateKey` in the spec | various | Yes | #707 to #714, fixed in #719 |
| No image dimensions or image thumbnails (thumbnails are video-only; `AttachmentDto` has no width or height) | `backend/src/file/thumbnail.service.ts`, `AttachmentDto` | Yes (layout) | #715, open: blocks W7-thumbnails |
| A server proxy for GIF and link-preview media | | | #716, closed as not planned (owner decision above) |


### Backend asks W9

Found while building the W9 core lane (2026-11-12). None blocks it; each has a workaround.

| Ask | Where | Why | Native's workaround meanwhile |
|---|---|---|---|
| Say `code` optional in `CreateUserDto` | `contract/openapi.json`, `backend/src/user/dto/create-user.dto.ts` (`@IsOptional() code?`) | The backend honours `OPEN` with no code, but the contract still requires the field, so a generated client must invent one | Sends `""`, which the backend reads as absent |
| Tell a "seen by" list that a channel receipt moved | `backend/src/read-receipts/read-receipts.service.ts` (`markAsRead`) | Channels send no `readReceiptUpdated` (privacy), so a channel message's readers are only read when shown and stay as read until a reconnect | Read once per message; `keys::MESSAGE_READERS` is invalidated on a new connection |
| A per-track gain for screen-share audio | `semaphore-media-livekit/src/audio/mixer.rs` (`set_volume` is per identity) | The web keeps a separate screen-share volume per user; the native mixer gives a member one gain for the mic and the share | Participant volume applies to both (one slider, not two); the web's separate share slider waits on the mixer |
| A voice-isolation counterpart | `semaphore-media-livekit/src/audio/apm.rs` | The web's "voice isolation" is a browser audio feature; libwebrtc's APM has echo cancellation, noise suppression and AGC only | The persisted toggles are echo cancellation, noise suppression and AGC; voice isolation is not offered |
