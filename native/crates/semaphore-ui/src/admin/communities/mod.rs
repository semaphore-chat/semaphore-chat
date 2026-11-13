//! UA4: every community on the instance with its counts, search, paging and force delete, after
//! `pages/admin/AdminCommunitiesPage.tsx`.
//!
//! What this user may do comes from core's `InstanceAdminCaps`, never from roles: an action it
//! doesn't allow shows disabled with the reason, not hidden. The rows' search, paging, counts and
//! the detail (members, channels, messages, created) are all core's (`AdminCommunitiesView`,
//! `AdminCommunityView`); the page only draws them and says what was pressed.
//!
//! A force delete reports on the detail's op (`Core::admin_community`), so its spinner and its
//! failure live in the detail card next to the button that sent it, and in the confirm that is
//! still open while it runs.

#[cfg(any(test, feature = "stories"))]
mod fixtures;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::community_settings::common::{
    card, empty_line, field_error, list, loading_rows, locked_button, locked_note, page, row,
};
use crate::community_settings::rules::{
    Outcome, Pending, act, confirms_name, date_label, failure, needs, running,
};
use crate::dms::picker::DEBOUNCE;
use crate::kit::{
    Alert, Button, ButtonTone, Dialog, Severity, TextField, Variant, spacing, text, text_state,
};
use crate::messages::TimeFormat;
use crate::panel::common::{design_icon, error_block};
use crate::shell::community_avatar;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminCommunitiesView, AdminCommunityRow, AdminCommunityView,
    InstanceAdminCaps, LoadState,
};
use semaphore_design::Icon as DesignIcon;

/// From this window width a row has room for its counts and the creation date beside the name.
const WIDE_MIN_WINDOW: f32 = 1060.;

#[derive(Debug, Clone, PartialEq)]
pub enum CommunitiesEvent {
    /// The search changed: the owner reads `Core::admin_communities(search)`.
    Search(String),
    /// `Core::load_more_admin_communities(search)`.
    LoadMore,
    /// A row opened: the owner feeds `set_detail` from `Core::admin_community(id)`.
    Open { community_id: String },
    /// Confirmed: `Core::force_delete_community(id)`.
    ForceDelete { community_id: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct CommunitiesPage {
    caps: InstanceAdminCaps,
    view: AdminCommunitiesView,
    detail: Option<AdminCommunityView>,
    field: Entity<InputState>,
    /// What is in the search field, and the query that went out last.
    typed: String,
    asked: Option<String>,
    debounce: Option<Task<()>>,
    /// The community whose delete confirm is open.
    deleting: Option<String>,
    delete_typed: Entity<InputState>,
    /// The force deletes sent, each followed through the detail's op.
    pending: Vec<Pending>,
    time: TimeFormat,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<CommunitiesEvent> for CommunitiesPage {}

impl CommunitiesPage {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = text_state(window, cx, false);
        let delete_typed = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.subscribe_in(&field, window, |this, field, event, _, cx| {
                if let InputEvent::Change = event {
                    let text = field.read(cx).value().to_string();
                    this.query_changed(&text, cx);
                }
            }),
            cx.observe(&delete_typed, |_, _, cx| cx.notify()),
        ];
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminCommunitiesView::default(),
            detail: None,
            field,
            typed: String::new(),
            asked: None,
            debounce: None,
            deleting: None,
            delete_typed,
            pending: Vec::new(),
            time: TimeFormat::default(),
            _subscriptions,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_communities(search)`.
    pub fn set_view(&mut self, view: AdminCommunitiesView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// `Core::admin_community(id)` for the open row.
    pub fn set_detail(&mut self, detail: Option<AdminCommunityView>, cx: &mut Context<Self>) {
        if let Some(detail) = &detail {
            let mut succeeded = false;
            self.pending
                .retain_mut(|pending| match pending.observe(&detail.op) {
                    // A failure stays in the op, where the card and its confirm read it.
                    Outcome::Waiting => true,
                    Outcome::Failed => false,
                    Outcome::Succeeded => {
                        succeeded = true;
                        false
                    }
                });
            if succeeded {
                self.deleting = None;
            }
        }
        self.detail = detail;
        cx.notify();
    }

    /// What the field has typed, in `time`'s zone, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn set_time(&mut self, time: TimeFormat) {
        self.time = time;
    }

    /// The search field as if `query` were typed and sent, without waiting for the debounce.
    #[cfg(feature = "stories")]
    pub(crate) fn preset_search(
        &mut self,
        query: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let typed = query.to_owned();
        self.field
            .update(cx, |field, cx| field.set_value(typed.clone(), window, cx));
        self.typed = typed.clone();
        self.asked = Some(typed);
        self.debounce = None;
    }

    /// The delete confirm open with `typed` in its field, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn open_delete(&mut self, typed: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.deleting = self
            .detail
            .as_ref()
            .and_then(|detail| detail.community.as_ref())
            .map(|community| community.id.clone());
        let typed = typed.to_owned();
        self.delete_typed
            .update(cx, |field, cx| field.set_value(typed, window, cx));
    }

    /// The field changed: (re)start the 300 ms debounce, and send what was typed when it runs out.
    pub(crate) fn query_changed(&mut self, text: &str, cx: &mut Context<Self>) {
        if text == self.typed {
            return;
        }
        self.typed = text.to_owned();
        self.debounce = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(DEBOUNCE).await;
            this.update(cx, |this, cx| {
                this.debounce = None;
                if this.asked.as_deref() != Some(this.typed.as_str()) {
                    this.asked = Some(this.typed.clone());
                    cx.emit(CommunitiesEvent::Search(this.typed.clone()));
                }
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn delete_action(community_id: &str) -> AdminAction {
        act(AdminActionKind::ForceDeleteCommunity, Some(community_id))
    }

    fn start_delete(&mut self, community_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if !self.caps.communities_delete {
            return;
        }
        self.deleting = Some(community_id.to_owned());
        self.delete_typed
            .update(cx, |field, cx| field.set_value("", window, cx));
        cx.notify();
    }

    pub(crate) fn confirm_delete(&mut self, cx: &mut Context<Self>) {
        let Some(community) = self
            .detail
            .as_ref()
            .and_then(|detail| detail.community.as_ref())
        else {
            return;
        };
        let (id, name) = (community.id.clone(), community.name.clone());
        let op = self
            .detail
            .as_ref()
            .map(|detail| detail.op.clone())
            .unwrap_or_default();
        let action = Self::delete_action(&id);
        if !self.caps.communities_delete
            || running(&op, &action)
            || self.pending.iter().any(|pending| pending.action == action)
            || !confirms_name(&self.delete_typed.read(cx).value(), &name)
        {
            return;
        }
        self.pending.push(Pending::new(action, &op));
        cx.emit(CommunitiesEvent::ForceDelete { community_id: id });
        cx.notify();
    }

    /// "12 members · 4 channels", the row's second line at a phone's width, where the counts have
    /// no room for columns and the creation date waits in the detail card.
    fn phone_meta(community: &AdminCommunityRow) -> String {
        let count = |n: u64, one: &str, many: &str| {
            if n == 1 {
                format!("1 {one}")
            } else {
                format!("{n} {many}")
            }
        };
        format!(
            "{} \u{b7} {}",
            count(community.member_count, "member", "members"),
            count(community.channel_count, "channel", "channels")
        )
    }

    fn community_row(
        &self,
        community: &AdminCommunityRow,
        wide: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let id = community.id.clone();
        let open_id = id.clone();
        let hover = sem.list_hover;
        let name = community.name.clone();
        let mut words = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(2.))
            .child(
                text(Variant::Body2, name)
                    .font_weight(FontWeight(500.))
                    .truncate()
                    .text_color(sem.text_primary),
            )
            .children(community.description.clone().map(|description| {
                text(Variant::Caption, description)
                    .truncate()
                    .text_color(sem.text_secondary)
            }));
        if !wide {
            words = words.child(
                text(Variant::Caption, Self::phone_meta(community))
                    .truncate()
                    .text_color(sem.text_secondary),
            );
        }
        let entry = row(
            SharedString::from(format!("admin-community-{id}")),
            community.name.clone(),
            cx,
        )
        .role(Role::Link)
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .child(community_avatar(
            &id,
            &community.name,
            community.avatar_file_id.as_deref(),
            40.,
        ))
        .child(words)
        .when(wide, |entry| {
            entry
                .child(stat(community.member_count, "Members", cx))
                .child(stat(community.channel_count, "Channels", cx))
                .child(stat(
                    date_label(&self.time, community.created_at_ms),
                    "Created",
                    cx,
                ))
        })
        .child(design_icon(
            DesignIcon::ChevronRight,
            20.,
            sem.text_secondary,
        ))
        .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
            cx.emit(CommunitiesEvent::Open {
                community_id: open_id.clone(),
            });
        }));
        entry.into_any_element()
    }

    fn more_button(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .pt(spacing(1.))
            .flex()
            .justify_center()
            .child(
                Button::new("admin-communities-more", "Load more")
                    .outlined()
                    .loading(self.view.loading_more)
                    .disabled(self.view.loading_more)
                    .on_click(cx.listener(|_, _: &ClickEvent, _, cx| {
                        cx.emit(CommunitiesEvent::LoadMore);
                    })),
            )
            .into_any_element()
    }

    fn empty_sentence(&self) -> String {
        if self.view.search.is_empty() {
            "No communities found".to_owned()
        } else {
            "No communities match your search".to_owned()
        }
    }

    fn list_card(&self, wide: bool, cx: &mut Context<Self>) -> AnyElement {
        let listing: AnyElement = match &self.view.state {
            LoadState::Loading => {
                loading_rows("admin-communities-loading", "Loading communities", 5)
            }
            LoadState::Failed { error } => error_block(
                "admin-communities-retry",
                "Failed to load communities",
                error.message.clone(),
                cx.listener(|_, _: &ClickEvent, _, cx| cx.emit(CommunitiesEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.rows.is_empty() => {
                empty_line(self.empty_sentence(), cx).into_any_element()
            }
            LoadState::Ready => {
                let rows = self.view.rows.clone();
                let items: Vec<_> = rows
                    .iter()
                    .map(|community| self.community_row(community, wide, cx))
                    .collect();
                list("admin-communities-list", "Communities")
                    .children(items)
                    .into_any_element()
            }
        };
        let more = (matches!(self.view.state, LoadState::Ready) && self.view.more)
            .then(|| self.more_button(cx));
        let title = match self.view.state {
            LoadState::Ready => format!("Communities ({})", self.view.rows.len()),
            _ => "Communities".to_owned(),
        };
        card(
            title,
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.5))
                .child(
                    TextField::new(
                        "admin-communities-search",
                        &self.field,
                        "Search communities",
                    )
                    .placeholder("Search communities..."),
                )
                .child(listing)
                .children(more),
            cx,
        )
        .into_any_element()
    }

    fn detail_body(
        &self,
        community: &AdminCommunityRow,
        detail: &AdminCommunityView,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let delete = Self::delete_action(&community.id);
        let busy = running(&detail.op, &delete);
        let error = failure(&detail.op, &delete);
        let locked = (!self.caps.communities_delete).then(|| needs("Delete communities"));
        let id = community.id.clone();
        div()
            .flex()
            .flex_col()
            .gap(spacing(2.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .child(community_avatar(
                        &community.id,
                        &community.name,
                        community.avatar_file_id.as_deref(),
                        48.,
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(
                                text(Variant::Body1, community.name.clone())
                                    .font_weight(FontWeight(500.))
                                    .truncate()
                                    .text_color(sem.text_primary),
                            )
                            .children(community.description.clone().map(|description| {
                                text(Variant::Caption, description)
                                    .truncate()
                                    .text_color(sem.text_secondary)
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(spacing(3.))
                    .child(stat(community.member_count, "Members", cx))
                    .child(stat(community.channel_count, "Channels", cx))
                    .child(stat(detail.message_count, "Messages", cx))
                    .child(stat(
                        date_label(&self.time, community.created_at_ms),
                        "Created",
                        cx,
                    )),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap(px(4.))
                    // The confirm already says it while it is open.
                    .children(error.filter(|_| self.deleting.is_none()).map(|error| {
                        div()
                            .id("admin-community-delete-error")
                            .test_support()
                            .child(field_error(error.message.clone(), cx))
                    }))
                    .child(locked_button(
                        Button::new("admin-community-delete", "Delete Community")
                            .contained()
                            .tone(ButtonTone::Danger)
                            .loading(busy)
                            .on_click(cx.listener(move |page, _, window, cx| {
                                page.start_delete(&id, window, cx);
                            })),
                        "admin-community-delete-locked",
                        locked,
                        cx,
                    )),
            )
            .into_any_element()
    }

    fn detail_card(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let detail = self.detail.clone()?;
        let body: AnyElement = match &detail.state {
            LoadState::Loading => {
                loading_rows("admin-community-detail-loading", "Loading community", 2)
            }
            LoadState::Failed { error } => {
                Alert::new(Severity::Error, error.message.clone()).into_any_element()
            }
            LoadState::Ready => match &detail.community {
                Some(community) => self.detail_body(community, &detail, cx),
                None => empty_line("This community is no longer there", cx).into_any_element(),
            },
        };
        Some(card("Community", body, cx).into_any_element())
    }

    fn delete_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let detail = self.detail.as_ref()?;
        let community = detail.community.as_ref()?;
        let sem = cx.sem().clone();
        let action = Self::delete_action(&community.id);
        let busy = running(&detail.op, &action);
        let matched = confirms_name(&self.delete_typed.read(cx).value(), &community.name);
        let error = failure(&detail.op, &action)
            .map(|error| Alert::new(Severity::Error, error.message.clone()));
        let cancel = cx.weak_entity();
        let close = cx.weak_entity();
        let confirm = cx.weak_entity();
        Some(
            Dialog::new("Delete Community")
                .width(480.)
                .body(
                    div()
                        .flex()
                        .flex_col()
                        .gap(spacing(2.))
                        .children(error)
                        .child(text(
                            Variant::Body2,
                            format!(
                                "This permanently deletes \u{201c}{}\u{201d} for everyone: its channels, messages, members and files. This can't be undone.",
                                community.name
                            ),
                        ))
                        .child(
                            text(Variant::Body2, "Type the community's name to confirm.")
                                .text_color(sem.text_primary),
                        )
                        .child(
                            TextField::new(
                                "admin-community-delete-typed",
                                &self.delete_typed,
                                "Community name",
                            )
                            .disabled(busy),
                        ),
                )
                .action(
                    Button::new("admin-community-delete-cancel", "Cancel")
                        .disabled(busy)
                        .on_click(move |_, _, cx| {
                            cancel
                                .update(cx, |page, cx| {
                                    page.deleting = None;
                                    cx.notify();
                                })
                                .ok();
                        }),
                )
                .action(
                    Button::new("admin-community-delete-confirm", "Delete Community")
                        .contained()
                        .tone(ButtonTone::Danger)
                        .disabled(!matched)
                        .loading(busy)
                        .on_click(move |_, _, cx| {
                            confirm
                                .update(cx, |page, cx| page.confirm_delete(cx))
                                .ok();
                        }),
                )
                .on_close(move |_, cx| {
                    close
                        .update(cx, |page, cx| {
                            if !page.is_deleting() {
                                page.deleting = None;
                                cx.notify();
                            }
                        })
                        .ok();
                }),
        )
    }

    /// A force delete is on its way: the confirm can't be dismissed.
    fn is_deleting(&self) -> bool {
        self.detail.as_ref().is_some_and(|detail| {
            detail
                .community
                .as_ref()
                .is_some_and(|community| running(&detail.op, &Self::delete_action(&community.id)))
        })
    }
}

/// A small self-labelling figure: the value over its name.
fn stat(value: impl std::fmt::Display, label: &'static str, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .flex()
        .flex_shrink_0()
        .flex_col()
        .gap(px(2.))
        .child(
            text(Variant::Body2, value.to_string())
                .font_weight(FontWeight(600.))
                .whitespace_nowrap()
                .text_color(sem.text_primary),
        )
        .child(
            text(Variant::Caption, label)
                .whitespace_nowrap()
                .text_color(sem.text_secondary),
        )
}

impl Render for CommunitiesPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let wide = f32::from(window.viewport_size().width) >= WIDE_MIN_WINDOW;
        let body: AnyElement = if !self.caps.communities_read {
            locked_note(
                "admin-communities-locked",
                needs("Read all communities"),
                cx,
            )
            .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .children(self.detail_card(cx))
                .child(self.list_card(wide, cx))
                .into_any_element()
        };
        let overlay = if self.deleting.is_some() {
            self.delete_dialog(cx)
                .map(|dialog| dialog.into_any_element())
        } else {
            None
        };
        div()
            .relative()
            .size_full()
            .child(page(
                "admin-communities",
                "Communities",
                Some("View and manage all communities on this instance".into()),
                Vec::new(),
                body,
                window,
                cx,
            ))
            .children(overlay)
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
