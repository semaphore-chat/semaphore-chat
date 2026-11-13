//! `InviteScreen`, after `JoinInvitePage.tsx`: an instance invite's preview. Signed out, "Join"
//! goes on to `RegisterScreen` with the code. Signed in, "Join with your account" joins the
//! invite's communities with `Core::accept_invite` and the screen lists what was joined, and what
//! was skipped and why. A code the server won't honour (unknown, expired, used up or disabled)
//! shows the reason it gave, or the generic line when it gave none.

use super::{card, event_link, page};
use crate::kit::{Alert, Button, Icon, Severity, Spinner, Variant, spacing, text};
use crate::messages::TimeFormat;
use crate::panel::common::error_block;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    InviteJoin, InvitePreview, InvitePreviewView, InviteSkipReason, LoadState,
};
use semaphore_design::Icon as IconName;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InviteEvent {
    /// "Join" (signed out): the owner opens `RegisterScreen` with `set_invite_code(code)`;
    /// "Join with your account" (signed in): `Core::accept_invite(code)`.
    Accept { code: String },
    /// "Login here", or "Back to sign in" from an invite that can't be used.
    SignIn,
    /// The preview got no answer and the user asked again: `Core::retry_failed`.
    Retry,
    /// "Close" on the signed-in page.
    Close,
}

/// U-freeze (US1): where "Join with your account" stands (`Core::accept_invite`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum InviteJoinState {
    #[default]
    Idle,
    Joining,
    Joined(InviteJoin),
    /// The server's message.
    Failed(String),
}

pub struct InviteScreen {
    view: InvitePreviewView,
    signed_in: bool,
    join: InviteJoinState,
    time: TimeFormat,
}

impl EventEmitter<InviteEvent> for InviteScreen {}

/// `formatDate`: "Nov 11, 2026", in `time`'s zone (the user's, unless a story fixes one).
pub(crate) fn invite_date(time: &TimeFormat, ms: i64) -> String {
    time.format_at(ms, "%b %-d, %Y")
}

/// Why a code can't be used, in words: the server's `INVITE_*` code says it, and anything else is
/// the server's own message, shown as it came.
pub(crate) fn invite_reason(reason: &str) -> String {
    let original = reason.trim();
    let code = original.strip_prefix("INVITE_").unwrap_or(original);
    match code {
        "NOT_FOUND" => "This invite doesn't exist".to_owned(),
        "EXPIRED" => "This invite has expired".to_owned(),
        "EXHAUSTED" => "This invite has been used up".to_owned(),
        "DISABLED" => "This invite has been disabled".to_owned(),
        // An older server, or a message this build doesn't know: show it as it came.
        _ => original.to_owned(),
    }
}

/// Why an invite skipped a community, in the web's words.
fn skip_reason(reason: InviteSkipReason) -> &'static str {
    match reason {
        InviteSkipReason::AlreadyMember => "You're already a member",
        InviteSkipReason::Banned => "You're banned from it",
        InviteSkipReason::Other => "Couldn't join",
    }
}

impl InviteScreen {
    /// U-freeze (US1): the signed-in join's progress and result. Drawn by US1.
    pub fn set_join(&mut self, join: InviteJoinState, cx: &mut Context<Self>) {
        self.join = join;
        cx.notify();
    }

    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            view: InvitePreviewView::default(),
            signed_in: false,
            join: InviteJoinState::default(),
            time: TimeFormat::default(),
        }
    }

    /// `Core::invite_preview(code)`, read again on `ViewChanged { InvitePreview { code } }`.
    pub fn set_view(&mut self, view: InvitePreviewView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// The link was opened while signed in: only the message shows.
    pub fn set_signed_in(&mut self, signed_in: bool, cx: &mut Context<Self>) {
        self.signed_in = signed_in;
        cx.notify();
    }

    /// The zone "Expires …" is written in: the app's, unless a story fixes it.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    fn heading(icon: IconName, color: Hsla, title: &'static str) -> Div {
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .child(
                div()
                    .mb(spacing(2.))
                    .child(Icon::new(icon).size(40.).color(color)),
            )
            .child(text(Variant::H5, title).mb(spacing(2.)).text_center())
    }

    fn back_button(cx: &mut Context<Self>) -> impl IntoElement + use<> {
        Button::new("invite-sign-in", "Back to sign in")
            .contained()
            .full_width()
            .on_click(cx.listener(|_, _, _, cx| cx.emit(InviteEvent::SignIn)))
    }

    /// "Back to sign in", or "Close" when the page was opened signed in.
    fn leave_button(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.signed_in {
            Button::new("invite-close", "Close")
                .contained()
                .full_width()
                .on_click(cx.listener(|_, _, _, cx| cx.emit(InviteEvent::Close)))
                .into_any_element()
        } else {
            Self::back_button(cx).into_any_element()
        }
    }

    /// The signed-in join: its result, the button, then the server's refusal under it.
    fn join_area(&self, code: &str, cx: &mut Context<Self>) -> Div {
        let code = code.to_owned();
        let joining = self.join == InviteJoinState::Joining;
        let joined = matches!(self.join, InviteJoinState::Joined(_));
        let refused = match &self.join {
            InviteJoinState::Failed(message) => Some(message.clone()),
            _ => None,
        };
        div()
            .w_full()
            .flex()
            .flex_col()
            .children(self.join_result(cx))
            // A joined invite needs no second press; a refused one can be tried again.
            .when(!joined, |area| {
                area.child(
                    div().w_full().mb(spacing(2.)).child(
                        Button::new("invite-join", "Join with your account")
                            .contained()
                            .full_width()
                            .loading(joining)
                            .on_click(cx.listener(move |_, _, _, cx| {
                                cx.emit(InviteEvent::Accept { code: code.clone() })
                            })),
                    ),
                )
            })
            .children(refused.map(|message| {
                div()
                    .id("invite-join-error")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(Alert::new(Severity::Error, message))
            }))
            .child(
                Button::new("invite-close", "Close")
                    .outlined()
                    .full_width()
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(InviteEvent::Close))),
            )
    }

    /// What `Core::accept_invite` joined and what it skipped, with why.
    fn join_result(&self, cx: &App) -> Option<AnyElement> {
        let InviteJoinState::Joined(join) = &self.join else {
            return None;
        };
        let sem = cx.sem();
        let block = div().w_full().flex().flex_col().gap(spacing(0.5));
        if join.is_empty() {
            return Some(joined_block(
                block.child(
                    div()
                        .id("invite-joined-nothing")
                        .test_support()
                        .role(Role::Note)
                        .aria_label("You're already in every community this invite adds")
                        .child(
                            text(
                                Variant::Body2,
                                "You're already in every community this invite adds",
                            )
                            .text_color(sem.text_secondary)
                            .text_center(),
                        ),
                ),
            ));
        }
        let block = if join.joined.is_empty() {
            block
        } else {
            block
                .child(text(Variant::Subtitle2, "You joined").mb(spacing(0.5)))
                .children(join.joined.iter().enumerate().map(|(index, community)| {
                    community_row(
                        ElementId::from(("invite-joined", index)),
                        community.name.clone(),
                        None,
                        sem,
                    )
                }))
        };
        let block = if join.skipped.is_empty() {
            block
        } else {
            block
                .child(
                    text(Variant::Subtitle2, "Not joined")
                        .mt(spacing(1.5))
                        .mb(spacing(0.5)),
                )
                .children(join.skipped.iter().enumerate().map(|(index, community)| {
                    community_row(
                        ElementId::from(("invite-skipped", index)),
                        community.name.clone(),
                        Some(skip_reason(community.reason)),
                        sem,
                    )
                }))
        };
        Some(joined_block(block))
    }

    /// The invite itself, for a signed-out reader who can make an account with it, or for a
    /// signed-in one who can join its communities with their account.
    fn invitation(&self, invite: &InvitePreview, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let code = invite.code.clone();
        let subtitle = if self.signed_in {
            "You're signed in: join this invite with your account"
        } else {
            "You've been invited to make an account here"
        };
        let body = Self::heading(IconName::PersonAdd, sem.primary, "Join Semaphore Chat")
            .child(
                text(Variant::Body2, subtitle)
                    .text_color(sem.text_secondary)
                    .text_center()
                    .mb(spacing(3.)),
            )
            .child(self.details(invite, cx));
        if self.signed_in {
            return body.child(self.join_area(&code, cx)).into_any_element();
        }
        body.child(
            div().w_full().mb(spacing(2.)).child(
                Button::new("invite-accept", "Join")
                    .contained()
                    .full_width()
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(InviteEvent::Accept { code: code.clone() })
                    })),
            ),
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap_x(px(4.))
                .text_color(sem.text_secondary)
                .child(text(Variant::Body2, "Already have an account?"))
                .child(event_link(
                    "invite-login",
                    "Login here",
                    InviteEvent::SignIn,
                    cx,
                )),
        )
        .into_any_element()
    }

    /// A code the server won't honour: its reason when it gave one, the generic line otherwise.
    fn unusable(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let message = self
            .view
            .reason
            .as_deref()
            .map(invite_reason)
            .unwrap_or_else(|| "This invite link is invalid or has expired.".to_owned());
        Self::heading(IconName::ErrorOutline, sem.error, "Invalid Invite")
            .child(
                div()
                    .id("invite-invalid")
                    .test_support()
                    .w_full()
                    .mb(spacing(2.))
                    .child(
                        div()
                            .id("invite-reason")
                            .test_support()
                            .child(Alert::new(Severity::Error, message)),
                    ),
            )
            .child(self.leave_button(cx))
            .into_any_element()
    }

    fn details(&self, invite: &InvitePreview, cx: &App) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let line = |label: &'static str, value: String| {
            div()
                .flex()
                .justify_between()
                .gap(spacing(2.))
                .child(text(Variant::Caption, label).text_color(sem.text_secondary))
                .child(text(Variant::Caption, value).min_w_0().truncate())
        };
        let uses = match invite.max_uses {
            Some(max) => format!("{}/{max}", invite.uses),
            None => invite.uses.to_string(),
        };
        div()
            .id("invite-details")
            .test_support()
            .w_full()
            .mb(spacing(3.))
            .p(spacing(2.))
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .flex()
            .flex_col()
            .gap(spacing(0.5))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .gap(spacing(2.))
                    .mb(spacing(0.5))
                    .child(text(Variant::Subtitle2, "Invite Code").text_color(sem.text_secondary))
                    .child(
                        text(Variant::Body2, invite.code.clone())
                            .font_weight(FontWeight(500.))
                            .min_w_0()
                            .truncate(),
                    ),
            )
            .children(invite.created_by.clone().map(|by| line("Created by", by)))
            .child(line("Uses", uses))
            .children(
                invite
                    .valid_until_ms
                    .map(|until| line("Expires", invite_date(&self.time, until))),
            )
    }
}

/// The join's result as one observed block, for the reader and the test rig.
fn joined_block(child: impl IntoElement) -> AnyElement {
    div()
        .id("invite-joined")
        .test_support()
        .w_full()
        .mb(spacing(2.))
        .child(child)
        .into_any_element()
}

/// One community in a join's result: its name truncating, and why it wasn't joined when it wasn't.
fn community_row(
    id: ElementId,
    name: String,
    reason: Option<&'static str>,
    sem: &crate::theme::Sem,
) -> AnyElement {
    let label = match reason {
        Some(reason) => format!("{name}, {reason}"),
        None => name.clone(),
    };
    div()
        .id(id)
        .test_support()
        .role(Role::ListItem)
        .aria_label(label)
        .w_full()
        .min_w_0()
        .flex()
        .flex_col()
        .px(spacing(1.5))
        .py(spacing(1.))
        .rounded(px(4.))
        .border_1()
        .border_color(sem.divider)
        .child(
            text(Variant::Body2, name)
                .min_w_0()
                .truncate()
                .text_color(sem.text_primary),
        )
        .children(
            reason.map(|reason| text(Variant::Caption, reason).text_color(sem.text_secondary)),
        )
        .into_any_element()
}

impl Render for InviteScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let body: AnyElement = match (&self.view.state, &self.view.invite) {
            (_, Some(invite)) => self.invitation(invite, cx),
            (LoadState::Loading, None) => div()
                .id("invite-loading")
                .test_support()
                .role(Role::Status)
                .w_full()
                .py(spacing(3.))
                .flex()
                .flex_col()
                .items_center()
                .gap(spacing(2.))
                .child(Spinner::new("invite-spinner").size(40.))
                .child(text(Variant::Body1, "Validating invite..."))
                .into_any_element(),
            (LoadState::Failed { .. }, None) => error_block(
                "invite-retry",
                "Couldn't check this invite",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(InviteEvent::Retry)),
                cx,
            ),
            // Read and empty: the server refused the code, and says why when it knows how.
            (LoadState::Ready, None) => self.unusable(cx),
        };
        page("invite-screen", &sem, card(sem.background_default, body))
    }
}

#[cfg(feature = "stories")]
pub(super) fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;
    use semaphore_core::model::{
        ErrorView, InviteJoin, InviteSkipReason, JoinedCommunity, SkippedInviteCommunity,
    };

    fn invite() -> InvitePreviewView {
        InvitePreviewView {
            state: LoadState::Ready,
            invite: Some(InvitePreview {
                code: "WELCOME-2026".into(),
                created_by: Some("mike".into()),
                uses: 3,
                max_uses: Some(10),
                valid_until_ms: Some(1_798_675_200_000),
            }),
            reason: None,
        }
    }

    fn failed(code: &str) -> InvitePreviewView {
        InvitePreviewView {
            state: LoadState::Failed {
                error: ErrorView {
                    code: code.into(),
                    message: "Request failed".into(),
                    retryable: true,
                    retry_after_ms: None,
                },
            },
            invite: None,
            reason: None,
        }
    }

    fn screen(view: InvitePreviewView, signed_in: bool, cx: &mut App) -> AnyView {
        with_join(view, signed_in, InviteJoinState::Idle, cx)
    }

    fn with_join(
        view: InvitePreviewView,
        signed_in: bool,
        join: InviteJoinState,
        cx: &mut App,
    ) -> AnyView {
        cx.new(|cx| {
            let mut screen = InviteScreen::new(cx);
            screen.set_time(TimeFormat::fixed(crate::messages::fixture::NOW_MS), cx);
            screen.set_view(view, cx);
            screen.set_signed_in(signed_in, cx);
            screen.set_join(join, cx);
            screen
        })
        .into()
    }

    /// A community name of exactly 100 characters, as the long-content stories need.
    fn long_name(tag: &str) -> String {
        let mut name = format!("The Very Long Community Name For {tag} ");
        while name.chars().count() < 100 {
            name.push('x');
        }
        name.chars().take(100).collect()
    }

    fn join(joined: Vec<String>, skipped: Vec<(String, InviteSkipReason)>) -> InviteJoin {
        InviteJoin {
            joined: joined
                .into_iter()
                .enumerate()
                .map(|(index, name)| JoinedCommunity {
                    id: format!("c-joined-{index}"),
                    name,
                })
                .collect(),
            skipped: skipped
                .into_iter()
                .enumerate()
                .map(|(index, (name, reason))| SkippedInviteCommunity {
                    id: format!("c-skipped-{index}"),
                    name,
                    reason,
                })
                .collect(),
        }
    }

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    /// An invite the server refused, with the `INVITE_*` code that says why.
    fn refused(reason: &str) -> InvitePreviewView {
        InvitePreviewView {
            state: LoadState::Ready,
            invite: None,
            reason: Some(reason.to_owned()),
        }
    }

    vec![
        Story::new("auth-invite-usable", |_, _, cx| screen(invite(), false, cx)),
        Story::new("auth-invite-long", |_, _, cx| {
            let mut view = invite();
            if let Some(invite) = view.invite.as_mut() {
                invite.code = "a-very-long-invite-code-that-someone-pasted-0123456789abcdef".into();
                invite.created_by = Some("maximilian_featherstonehaugh_wolfeschlegel".into());
                invite.max_uses = None;
                invite.valid_until_ms = None;
            }
            screen(view, false, cx)
        }),
        Story::new("auth-invite-invalid", |_, _, cx| {
            screen(
                InvitePreviewView {
                    state: LoadState::Ready,
                    invite: None,
                    reason: None,
                },
                false,
                cx,
            )
        }),
        Story::new("auth-invite-loading", |_, _, cx| {
            screen(InvitePreviewView::default(), false, cx)
        }),
        Story::new("auth-invite-failed", |_, _, cx| {
            screen(failed("NETWORK"), false, cx)
        }),
        Story::new("auth-invite-signed-in", |_, _, cx| {
            screen(invite(), true, cx)
        }),
        // US1: joining with the account that's already signed in.
        Story::new("invite-signed-in", |_, _, cx| screen(invite(), true, cx)),
        Story::new("invite-joining", |_, _, cx| {
            with_join(invite(), true, InviteJoinState::Joining, cx)
        }),
        Story::new("invite-joined", |_, _, cx| {
            with_join(
                invite(),
                true,
                InviteJoinState::Joined(join(names(&["Maple City"]), Vec::new())),
                cx,
            )
        }),
        Story::new("invite-joined-some-skipped", |_, _, cx| {
            with_join(
                invite(),
                true,
                InviteJoinState::Joined(join(
                    names(&["Maple City", "Harbor Town"]),
                    vec![
                        ("Pine Ridge".to_owned(), InviteSkipReason::AlreadyMember),
                        ("Bayview".to_owned(), InviteSkipReason::Banned),
                        ("Old Mill".to_owned(), InviteSkipReason::Other),
                    ],
                )),
                cx,
            )
        }),
        Story::new("invite-joined-nothing-new", |_, _, cx| {
            with_join(
                invite(),
                true,
                InviteJoinState::Joined(InviteJoin::default()),
                cx,
            )
        }),
        Story::new("invite-join-failed", |_, _, cx| {
            with_join(
                invite(),
                true,
                InviteJoinState::Failed(
                    "This invite is no longer usable. Ask an admin for a new one.".into(),
                ),
                cx,
            )
        }),
        Story::new("invite-expired", |_, _, cx| {
            screen(refused("INVITE_EXPIRED"), false, cx)
        }),
        Story::new("invite-exhausted", |_, _, cx| {
            screen(refused("INVITE_EXHAUSTED"), false, cx)
        }),
        Story::new("invite-not-found", |_, _, cx| {
            screen(refused("INVITE_NOT_FOUND"), false, cx)
        }),
        Story::new("invite-disabled", |_, _, cx| {
            screen(refused("INVITE_DISABLED"), false, cx)
        }),
        Story::new("invite-long-names", |_, _, cx| {
            let joined = (0..50)
                .map(|index| long_name(&format!("joined {index:02}")))
                .collect();
            with_join(
                invite(),
                true,
                InviteJoinState::Joined(join(
                    joined,
                    vec![(
                        long_name("already a member"),
                        InviteSkipReason::AlreadyMember,
                    )],
                )),
                cx,
            )
        }),
        Story::new("invite-phone", |_, _, cx| {
            with_join(
                invite(),
                true,
                InviteJoinState::Joined(join(
                    vec![long_name("joined one"), "Maple City".to_owned()],
                    vec![(long_name("banned"), InviteSkipReason::Banned)],
                )),
                cx,
            )
        }),
    ]
}
