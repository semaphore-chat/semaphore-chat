//! Shell stories, on the web's own scenarios, plus a stand-in for the middle column until U9 and U10.

use super::fixtures::{Fake, Fixture, FixtureSource};
use super::*;
use crate::kit::{Button as KitButton, ButtonSize, on_core_event as subscribe, spacing};
use crate::stories::{Story, StoryEnv};
use semaphore_core::model::{Conversation, ListOp, MessageRow};
use std::cell::RefCell;
use std::collections::BTreeMap;

/// The fixture on screen, so `rig-shot`'s `emit` steps can change what a story reads.
pub struct ActiveFixture(pub Rc<FixtureSource>);

impl Global for ActiveFixture {}

/// A plain list of what core has sent for the conversation on screen. Not the real message list:
/// that's U9's. It proves `MessagesChanged` reaches the UI and fills the column for review.
pub struct StubConversation {
    rows: BTreeMap<Conversation, Vec<MessageRow>>,
}

struct GlobalStub(Entity<StubConversation>);

impl Global for GlobalStub {}

impl StubConversation {
    fn apply(&mut self, conversation: &Conversation, ops: &[ListOp]) {
        let rows = self.rows.entry(conversation.clone()).or_default();
        for op in ops {
            match op {
                ListOp::Reset { rows: next } => rows.clone_from(next),
                ListOp::Insert { index, rows: next } => {
                    let at = (*index as usize).min(rows.len());
                    rows.splice(at..at, next.iter().cloned());
                }
                ListOp::Remove { index, count } => {
                    let start = (*index as usize).min(rows.len());
                    let end = (start + *count as usize).min(rows.len());
                    rows.drain(start..end);
                }
                ListOp::Replace { index, rows: next } => {
                    for (offset, row) in next.iter().enumerate() {
                        if let Some(slot) = rows.get_mut(*index as usize + offset) {
                            slot.clone_from(row);
                        }
                    }
                }
            }
        }
    }
}

fn stub_rows(props: &ContentProps, _: &mut Window, cx: &mut App) -> AnyElement {
    let sem = cx.sem().clone();
    let conversation = props.route.conversation();
    let rows = conversation.as_ref().and_then(|conversation| {
        let stub = cx.try_global::<GlobalStub>()?.0.read(cx);
        stub.rows.get(conversation).cloned()
    });
    match (rows, props.channel.as_ref()) {
        (Some(rows), _) if !rows.is_empty() => div()
            .id("stub-messages")
            .size_full()
            .flex()
            .flex_col()
            .justify_end()
            .overflow_hidden()
            .p(spacing(2.))
            .children(rows.iter().rev().take(14).rev().map(|row| {
                let name = row
                    .author
                    .display_name
                    .clone()
                    .unwrap_or_else(|| row.author.username.clone());
                div()
                    .flex()
                    .gap(spacing(1.5))
                    .py(spacing(0.75))
                    .child(user_avatar(
                        &name,
                        row.author.avatar_file_id.as_deref(),
                        32.,
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(text(Variant::Body2, name).font_weight(FontWeight(600.)))
                            .child(text(Variant::Body1, row.display.clone())),
                    )
            }))
            .into_any_element(),
        (_, Some(channel)) => div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .text_color(sem.text_secondary)
            .child(text(Variant::H5, format!("Welcome to #{}", channel.name)))
            .child(text(Variant::Body1, "No messages yet"))
            .into_any_element(),
        // `CommunityPage` with no channel selected.
        (_, None) if props.route.community_id().is_some() => div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(spacing(2.))
            .text_color(sem.text_secondary)
            .when_some(props.community.as_ref(), |this, community| {
                this.child(text(Variant::H5, format!("Welcome to {}", community.name)))
            })
            .child(text(
                Variant::Body1,
                "Select a channel from the sidebar to get started",
            ))
            .into_any_element(),
        (_, None) => home_card(props, &sem).into_any_element(),
    }
}

/// `HomePage`'s empty state.
fn home_card(props: &ContentProps, sem: &crate::theme::Sem) -> impl IntoElement + use<> {
    let (primary, secondary) = (sem.primary, sem.text_secondary);
    let heading = match props.route {
        Route::DirectMessages => "Direct messages",
        _ => "Home",
    };
    div()
        .id("home")
        .size_full()
        .overflow_y_scroll()
        .flex()
        .justify_center()
        .px(spacing(3.))
        .child(
            div()
                .w_full()
                .max_w(px(960.))
                .pt(spacing(3.))
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .child(text(Variant::H5, heading).font_weight(FontWeight(700.)))
                .child(
                    Paper::new().w_full().child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(spacing(1.))
                            .px(spacing(3.))
                            .py(spacing(4.))
                            .child(Icon::new(IconName::Groups).size(32.).color(primary))
                            .child(
                                text(Variant::Body1, "You're not in any communities yet")
                                    .text_size(px(20.))
                                    .font_weight(FontWeight(600.)),
                            )
                            .child(
                                text(
                                    Variant::Body2,
                                    "Ask an admin of this server to add you to a community. You can still send direct messages in the meantime.",
                                )
                                .text_color(secondary)
                                .text_center(),
                            )
                            .child(
                                div().pt(spacing(1.5)).child(
                                    KitButton::new("home-message-someone", "Message someone")
                                        .outlined()
                                        .size(ButtonSize::Large)
                                        .start_icon(IconName::ChatBubbleOutline),
                                ),
                            ),
                    ),
                ),
        )
}

struct Options {
    scenario: &'static str,
    channel: Option<&'static str>,
    connection: ConnectionState,
    edit: fn(&mut Fixture),
    expanded: bool,
    members_open: bool,
    messages: bool,
    phone_content: bool,
    side_panel: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            scenario: "big-community",
            channel: Some("general"),
            connection: ConnectionState::Connected,
            edit: |_| {},
            expanded: false,
            members_open: false,
            messages: true,
            phone_content: false,
            side_panel: false,
        }
    }
}

fn shell_view(env: &StoryEnv, options: Options, cx: &mut App) -> AnyView {
    let views = env.scenario(options.scenario).unwrap_or_else(|error| {
        panic!("story scenario {}: {error}", options.scenario);
    });
    let json = env.scenarios_dir.join(format!("{}.json", options.scenario));
    let mut fixture = Fixture::load(views, &json).unwrap_or_else(|error| panic!("{error}"));
    (options.edit)(&mut fixture);
    let community = fixture.first_community();
    let channel_id = options.channel.and_then(|name| {
        fixture
            .channel_named(&community, name)
            .map(|channel| channel.id.clone())
    });
    let rows: BTreeMap<Conversation, Vec<MessageRow>> = if options.messages {
        fixture.views.messages.iter().cloned().collect()
    } else {
        BTreeMap::new()
    };
    let source = Rc::new(FixtureSource(RefCell::new(fixture)));
    cx.set_global(ActiveFixture(source.clone()));

    let route = match &channel_id {
        Some(channel_id) => Route::Channel {
            community_id: community.clone(),
            channel_id: channel_id.clone(),
        },
        None if community.is_empty() => Route::Home,
        None => Route::Community {
            community_id: community.clone(),
        },
    };

    let stub = cx.new(|_| StubConversation { rows });
    subscribe(
        stub.downgrade(),
        |stub, event, _| {
            if let CoreEvent::MessagesChanged { conversation, ops } = event {
                stub.apply(conversation, ops);
            }
        },
        cx,
    );
    cx.set_global(GlobalStub(stub));

    let (connection, expanded, members_open, phone_content, side_panel) = (
        options.connection,
        options.expanded,
        options.members_open,
        options.phone_content,
        options.side_panel,
    );
    let panel: Option<AnyView> = side_panel.then(|| cx.new(|_| PlaceholderPanel).into());
    cx.new(|cx| {
        let mut shell = Shell::new(source, route, Rc::new(stub_rows), connection, cx);
        shell.rail_expanded = expanded;
        shell.members_open = members_open;
        shell.phone_content = phone_content;
        shell.pinned_count = 1;
        shell.side_panel = panel;
        shell
    })
    .into()
}

/// Stands in for the pins, search or thread panel, which draw their own stories.
struct PlaceholderPanel;

impl Render for PlaceholderPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .size_full()
            .p(px(16.))
            .bg(sem.paper)
            .child(crate::kit::text(crate::kit::Variant::H6, "Side panel"))
    }
}

/// Mirrors `unreadCommunityScenario`: `resources` unread, and two mentions in `help-desk`.
fn mark_unread(fixture: &mut Fixture) {
    let community = fixture.first_community();
    if let Some(channel) = fixture.channel_named(&community, "resources") {
        channel.unread_count = 4;
    }
    if let Some(channel) = fixture.channel_named(&community, "help-desk") {
        channel.unread_count = 9;
        channel.mention_count = 2;
    }
}

fn long_names(fixture: &mut Fixture) {
    let community = fixture.first_community();
    let long = "A community whose name just keeps on going well past any sensible rail or header";
    if let Some(row) = fixture.views.communities.first_mut() {
        row.name = long.to_owned();
    }
    if let Some(channel) = fixture.channel_named(&community, "resources") {
        channel.name =
            "a-channel-name-that-keeps-on-going-long-past-the-right-edge-of-the-sidebar".into();
        channel.is_private = true;
        channel.unread_count = 3;
        channel.mention_count = 150;
    }
    if let Some(rows) = fixture.members.get_mut(&community) {
        for (index, row) in rows.iter_mut().enumerate() {
            if index % 3 == 1 {
                row.user.display_name =
                    Some("Somebody with a really very extremely long display name indeed".into());
                row.status =
                    Some("And a long status message that can't possibly fit in 240px".into());
            }
        }
    }
    if let Some(user) = fixture
        .views
        .channels
        .iter_mut()
        .flat_map(|channel| channel.voice_users.iter_mut())
        .next()
    {
        user.display_name =
            Some("A voice user with a name that runs on far too long to fit".into());
    }
    fixture.counts.dm_unread = 1500;
    fixture.counts.notifications_unread = 150;
}

fn connect_hangout(fixture: &mut Fixture) {
    let community = fixture.first_community();
    if let Some(id) = fixture
        .channel_named(&community, "Hangout")
        .map(|channel| channel.id.clone())
    {
        fixture.connect_voice(&id);
    }
}

macro_rules! shell_story {
    ($name:literal, $($field:ident: $value:expr),* $(,)?) => {
        Story::new($name, |env, _, cx| {
            #[allow(clippy::needless_update)]
            let options = Options { $($field: $value,)* ..Options::default() };
            shell_view(env, options, cx)
        })
    };
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("shell-connected", |env, _, cx| {
            shell_view(env, Options::default(), cx)
        }),
        shell_story!("shell-offline", connection: ConnectionState::Offline),
        shell_story!("shell-reconnecting", connection: ConnectionState::Disconnected),
        shell_story!("shell-unread", edit: mark_unread),
        shell_story!("shell-rail-expanded", expanded: true),
        shell_story!("shell-members-open", members_open: true, phone_content: true),
        shell_story!("shell-channel-pane", phone_content: true),
        shell_story!("shell-side-panel", side_panel: true, phone_content: true),
        shell_story!("shell-long-content", edit: long_names),
        shell_story!("shell-long-content-expanded", edit: long_names, expanded: true),
        shell_story!("shell-voice-connected", edit: connect_hangout),
        shell_story!("shell-empty-user", scenario: "empty-user", channel: None),
        shell_story!(
            "shell-empty-community",
            channel: None,
            edit: |fixture| {
                fixture.views.channels.clear();
                fixture.members.clear();
            },
        ),
        shell_story!("shell-empty-channel", messages: false),
        shell_story!(
            "shell-loading",
            edit: |fixture| {
                fixture.communities_state = Fake::Loading;
                fixture.members_state = Fake::Loading;
            },
        ),
        shell_story!(
            "shell-loading-channels",
            channel: None,
            edit: |fixture| {
                fixture.channels_state = Fake::Loading;
                fixture.members_state = Fake::Loading;
            },
        ),
        shell_story!(
            "shell-error",
            channel: None,
            edit: |fixture| {
                fixture.communities_state = Fake::Failed;
                fixture.channels_state = Fake::Failed;
                fixture.members_state = Fake::Failed;
            },
        ),
    ]
}
