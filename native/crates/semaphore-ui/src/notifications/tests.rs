//! Labels, the level tooltip and the settings form's patch, then the centre, the menu and the
//! settings section in a window: every event they emit, mark-read ones above all.

use super::*;
use crate::dms::rig::rig;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{
    Conversation, ErrorView, LoadState, NotificationKind, NotificationRow, NotificationSettings,
    NotificationSettingsView, UserView,
};

fn author() -> UserView {
    UserView {
        id: "u-ava".into(),
        username: "ava".into(),
        display_name: Some("Ava".into()),
        avatar_file_id: None,
    }
}

fn link() -> MessageLink {
    MessageLink {
        community_id: Some("c".into()),
        conversation: Conversation::Channel { id: "ch".into() },
        message_id: Some("m".into()),
    }
}

fn row(id: &str, kind: NotificationKind, read: bool) -> NotificationRow {
    NotificationRow {
        id: id.into(),
        kind,
        author: author(),
        link: link(),
        parent_message_id: (kind == NotificationKind::ThreadReply).then(|| "p".to_owned()),
        channel_name: Some("general".into()),
        preview: "hello".into(),
        created_at_ms: 0,
        read,
    }
}

fn list(rows: Vec<NotificationRow>, has_more: bool) -> NotificationList {
    NotificationList {
        state: LoadState::Ready,
        unread_count: rows.iter().filter(|r| !r.read).count() as u32,
        rows,
        has_more,
    }
}

fn failed() -> LoadState {
    LoadState::Failed {
        error: ErrorView {
            code: "NETWORK".into(),
            message: "down".into(),
            retryable: true,
            retry_after_ms: None,
        },
    }
}

// ---- Words. ----

#[test]
fn kinds_are_labelled_as_the_web_labels_them() {
    assert_eq!(kind_label(NotificationKind::Mention), "Mentioned you");
    assert_eq!(
        kind_label(NotificationKind::DirectMessage),
        "Sent a message"
    );
    assert_eq!(kind_label(NotificationKind::ChannelMessage), "New message");
    assert_eq!(
        kind_label(NotificationKind::ThreadReply),
        "Replied in a thread"
    );
    let label = notification_label(&row("n", NotificationKind::Mention, false), 60_000);
    assert_eq!(
        label,
        "Ava mentioned you: hello, in #general, 1 minute ago, unread"
    );
    let mut empty = row("n", NotificationKind::DirectMessage, true);
    empty.preview.clear();
    empty.channel_name = None;
    assert_eq!(
        notification_label(&empty, 0),
        "Ava: New message, less than a minute ago"
    );
}

#[test]
fn the_tooltip_says_whether_the_level_is_the_default() {
    assert_eq!(
        level_tooltip(None, NotifyLevel::Mentions),
        "Notification settings: Only @mentions (default)"
    );
    assert_eq!(
        level_tooltip(Some(NotifyLevel::Muted), NotifyLevel::Mentions),
        "Notification settings: Nothing"
    );
}

// ---- The settings form. ----

#[test]
fn times_are_24_hour_hh_mm() {
    for good in ["00:00", "07:30", "23:59"] {
        assert!(valid_time(good), "{good}");
    }
    for bad in ["24:00", "7:30", "07:60", "0730", "ab:cd", ""] {
        assert!(!valid_time(bad), "{bad}");
    }
}

#[test]
fn the_patch_carries_only_what_changed() {
    let mut form = SettingsForm::new(NotificationSettings::default());
    assert!(!form.is_dirty());
    assert_eq!(form.patch(None), Ok(NotificationSettingsPatch::default()));
    form.draft.play_sound = false;
    form.draft.default_level = NotifyLevel::All;
    assert!(form.is_dirty());
    assert_eq!(
        form.patch(None),
        Ok(NotificationSettingsPatch {
            play_sound: Some(false),
            default_level: Some(NotifyLevel::All),
            ..NotificationSettingsPatch::default()
        })
    );
}

#[test]
fn new_hours_carry_the_local_zone_and_cleared_ones_are_empty() {
    let mut form = SettingsForm::new(NotificationSettings::default());
    form.draft.dnd = true;
    form.set_time(true, "22:00");
    assert_eq!(form.patch(None), Err(SettingsError::OneTime));
    form.set_time(false, " 07:00 ");
    let patch = form.patch(Some("Europe/Berlin")).unwrap();
    assert_eq!(patch.dnd, Some(true));
    assert_eq!(patch.dnd_start.as_deref(), Some("22:00"));
    assert_eq!(patch.dnd_end.as_deref(), Some("07:00"));
    assert_eq!(patch.dnd_timezone.as_deref(), Some("Europe/Berlin"));

    let mut saved = form.draft.clone();
    saved.dnd_timezone = Some("Europe/Berlin".into());
    let mut form = SettingsForm::new(saved);
    form.set_time(true, "");
    form.set_time(false, "");
    let patch = form.patch(Some("Europe/Berlin")).unwrap();
    assert_eq!(
        patch.dnd_start.as_deref(),
        Some(""),
        "cleared is sent as empty"
    );
    assert_eq!(patch.dnd_end.as_deref(), Some(""));
    assert_eq!(patch.dnd_timezone, None, "no hours, no zone");
    form.set_time(true, "9:00");
    assert_eq!(form.patch(None), Err(SettingsError::BadTime));
}

#[test]
fn hours_saved_without_a_zone_get_one_on_the_next_save() {
    let saved = NotificationSettings {
        dnd: true,
        dnd_start: Some("22:00".into()),
        dnd_end: Some("07:00".into()),
        ..NotificationSettings::default()
    };
    let mut form = SettingsForm::new(saved.clone());
    form.draft.play_sound = !saved.play_sound;
    let patch = form.patch(Some("Europe/Berlin")).unwrap();
    assert_eq!(patch.dnd_timezone.as_deref(), Some("Europe/Berlin"));
    assert_eq!(patch.dnd_start, None, "the hours themselves are unchanged");

    let mut elsewhere = saved;
    elsewhere.dnd_timezone = Some("America/New_York".into());
    let mut form = SettingsForm::new(elsewhere);
    form.draft.play_sound = !form.draft.play_sound;
    let patch = form.patch(Some("Europe/Berlin")).unwrap();
    assert_eq!(
        patch.dnd_timezone, None,
        "a stored zone moves only with the hours"
    );
}

#[test]
fn a_reload_keeps_unsaved_changes() {
    let mut form = SettingsForm::new(NotificationSettings::default());
    form.load(NotificationSettings {
        play_sound: false,
        ..NotificationSettings::default()
    });
    assert!(
        !form.draft.play_sound,
        "an untouched form follows the server"
    );
    form.draft.dm_notifications = false;
    form.load(NotificationSettings::default());
    assert!(
        !form.draft.dm_notifications,
        "a touched one keeps its changes"
    );
    assert!(form.is_dirty());
    form.discard();
    assert!(!form.is_dirty());
}

// ---- The centre. ----

fn center(
    cx: &mut TestAppContext,
    list: NotificationList,
) -> crate::dms::rig::Rig<NotificationCenter, NotificationEvent> {
    rig(cx, 400., move |_, cx| {
        let mut center = NotificationCenter::new(cx);
        center.set_list(list, false, cx);
        center
    })
}

#[gpui_kit::test]
fn opening_an_unread_row_marks_it_read_first(cx: &mut TestAppContext) {
    let rig = center(
        cx,
        list(
            vec![
                row("a", NotificationKind::ThreadReply, false),
                row("b", NotificationKind::Mention, true),
            ],
            false,
        ),
    );
    rig.click(cx, "notification-a");
    rig.click(cx, "notification-b");
    assert_eq!(
        rig.events(),
        [
            NotificationEvent::MarkRead { id: "a".into() },
            NotificationEvent::Open {
                notification_id: "a".into(),
                link: link(),
                parent_message_id: Some("p".into()),
            },
            NotificationEvent::Open {
                notification_id: "b".into(),
                link: link(),
                parent_message_id: None,
            },
        ],
        "a read row only opens"
    );
}

#[gpui_kit::test]
fn mark_read_and_dismiss_act_on_their_row_alone(cx: &mut TestAppContext) {
    let rig = center(
        cx,
        list(
            vec![
                row("a", NotificationKind::Mention, false),
                row("b", NotificationKind::Mention, true),
            ],
            false,
        ),
    );
    assert!(
        !rig.has(cx, "notification-read-b"),
        "no mark read on a read row"
    );
    rig.click(cx, "notification-read-a");
    rig.click(cx, "notification-dismiss-b");
    rig.click(cx, "notifications-mark-all");
    rig.click(cx, "notifications-close");
    assert_eq!(
        rig.events(),
        [
            NotificationEvent::MarkRead { id: "a".into() },
            NotificationEvent::Dismiss { id: "b".into() },
            NotificationEvent::MarkAllRead,
            NotificationEvent::Close,
        ]
    );
}

#[gpui_kit::test]
fn mark_all_only_shows_with_something_unread(cx: &mut TestAppContext) {
    let rig = center(
        cx,
        list(vec![row("a", NotificationKind::Mention, true)], false),
    );
    assert!(!rig.has(cx, "notifications-mark-all"));
    assert!(!rig.has(cx, "notifications-more"), "no more to load");
}

#[gpui_kit::test]
fn load_more_asks_once_while_a_page_is_on_its_way(cx: &mut TestAppContext) {
    let rig = center(
        cx,
        list(vec![row("a", NotificationKind::Mention, true)], true),
    );
    rig.click(cx, "notifications-more");
    rig.with(cx, |center, _, cx| {
        center.update(cx, |center, cx| {
            center.set_list(
                list(vec![row("a", NotificationKind::Mention, true)], true),
                true,
                cx,
            )
        })
    });
    rig.click(cx, "notifications-more");
    assert_eq!(rig.events(), [NotificationEvent::LoadMore]);
}

#[gpui_kit::test]
fn a_failed_or_empty_centre_asks_again(cx: &mut TestAppContext) {
    let rig = center(
        cx,
        NotificationList {
            state: failed(),
            ..NotificationList::default()
        },
    );
    rig.click(cx, "notifications-retry");
    rig.with(cx, |center, _, cx| {
        center.update(cx, |center, cx| {
            center.set_list(list(Vec::new(), false), false, cx)
        })
    });
    rig.click(cx, "notifications-refresh");
    assert_eq!(
        rig.events(),
        [NotificationEvent::Retry, NotificationEvent::Retry]
    );
}

// ---- The level menu. ----

#[gpui_kit::test]
fn the_menu_sets_a_level_or_goes_back_to_the_default(cx: &mut TestAppContext) {
    let rig = rig(cx, 800., |_, cx| {
        let mut menu = ChannelNotifyMenu::new(cx);
        menu.set_view(
            ChannelNotifyLevelView {
                state: LoadState::Ready,
                level: None,
                effective: NotifyLevel::Mentions,
            },
            cx,
        );
        menu
    });
    rig.click(cx, "notify-level-button");
    assert!(rig.has(cx, "notify-level-menu"));
    assert!(
        !rig.has(cx, "notify-level-default"),
        "already on the default"
    );
    rig.click(cx, "notify-level-all");
    assert!(!rig.has(cx, "notify-level-menu"), "a choice closes it");
    rig.with(cx, |menu, _, cx| {
        menu.update(cx, |menu, cx| {
            menu.set_view(
                ChannelNotifyLevelView {
                    state: LoadState::Ready,
                    level: Some(NotifyLevel::All),
                    effective: NotifyLevel::All,
                },
                cx,
            )
        })
    });
    rig.click(cx, "notify-level-button");
    rig.click(cx, "notify-level-all");
    rig.click(cx, "notify-level-button");
    rig.click(cx, "notify-level-default");
    assert_eq!(
        rig.events(),
        [
            ChannelNotifyEvent::SetLevel(Some(NotifyLevel::All)),
            ChannelNotifyEvent::SetLevel(None),
        ],
        "choosing the level it already has asks nothing"
    );
}

// ---- The settings section. ----

#[gpui_kit::test]
fn save_sends_the_changes_and_only_when_there_are_some(cx: &mut TestAppContext) {
    let rig = rig(cx, 900., |window, cx| {
        let mut section = NotificationSettingsSection::new(window, cx);
        section.set_view(
            NotificationSettingsView {
                state: LoadState::Ready,
                settings: NotificationSettings::default(),
            },
            window,
            cx,
        );
        section
    });
    assert!(
        !rig.has(cx, "notification-settings-save"),
        "no bar without changes"
    );
    rig.click(cx, "notification-dms");
    rig.click(cx, "notification-level-muted");
    rig.click(cx, "notification-settings-save");
    assert_eq!(
        rig.events(),
        [SettingsEvent::Save(NotificationSettingsPatch {
            dm_notifications: Some(false),
            default_level: Some(NotifyLevel::Muted),
            ..NotificationSettingsPatch::default()
        })]
    );
    rig.click(cx, "notification-settings-discard");
    assert!(!rig.has(cx, "notification-settings-save"), "discarded");
    rig.click(cx, "notification-sound-preview");
    assert_eq!(
        rig.events().last(),
        Some(&SettingsEvent::PreviewSound(NotifySound::Default))
    );
}
