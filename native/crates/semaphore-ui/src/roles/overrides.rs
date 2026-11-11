//! A channel's permissions, after `ChannelPermissionsTab.tsx`: preset cards over the channel's
//! overrides (Normal, Read-only, Announcement; Mods only is not offered yet), who may post in the
//! read-only kinds (roles at or above the user show locked, "Kept automatically"), whether members
//! may attach files, and a stored set no preset makes shown as "Custom" in plain words. Mounts in
//! the Edit Channel dialog's Permissions slot (`ChannelsTab::set_permissions_slot`).
//!
//! The overrides themselves are core's to build (`Core::build_preset`, rank-dependent): this view
//! emits the choice. The advanced allow/deny/inherit matrix is later work beyond the web; it goes
//! where `custom_section` draws the summary today.

use super::common::{locked_note, phone, server_error};
use super::rules::{
    Card, Outcome, Pending, PresetChoice, PresetSupport, card_block, cards, choose_card, kept_roles,
    needs, preset_dirty, summarize, toggle_poster,
};
use crate::kit::{Alert, Button, Severity, Spinner, Switch, Variant, spacing, text, with_tip};
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ChannelOverwritesView, LoadState, RolesView};
use semaphore_design::Icon as DesignIcon;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelOverridesEvent {
    /// The choice changed: the app may answer with `set_kept(Core::build_preset(..).auto_allowed)`
    /// so the locked chips are exactly the roles the set keeps.
    Preview {
        channel_id: String,
        choice: PresetChoice,
    },
    /// "Save permissions": `Core::build_preset(channel, choice)`, then
    /// `Core::replace_channel_overwrites(channel, OverwritesDraft { preset, overwrites })`.
    Save {
        channel_id: String,
        choice: PresetChoice,
    },
}

pub struct ChannelOverrides {
    channel_id: String,
    view: ChannelOverwritesView,
    roles: RolesView,
    support: Option<PresetSupport>,
    kept: Option<Vec<String>>,
    choice: Option<PresetChoice>,
    sent: bool,
    pending: Option<Pending<()>>,
}

impl EventEmitter<ChannelOverridesEvent> for ChannelOverrides {}

impl ChannelOverrides {
    pub fn new(channel_id: String) -> Self {
        Self {
            channel_id,
            view: ChannelOverwritesView::default(),
            roles: RolesView::default(),
            support: None,
            kept: None,
            choice: None,
            sent: false,
            pending: None,
        }
    }

    pub fn channel_id(&self) -> &str {
        &self.channel_id
    }

    /// `Core::channel_overwrites(channel)`, again on `ViewKey::ChannelOverwrites`.
    pub fn set_overwrites(&mut self, view: ChannelOverwritesView, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending.as_mut() {
            match pending.observe(view.op.busy, view.op.error.as_ref()) {
                Outcome::Waiting => {}
                Outcome::Failed => self.pending = None,
                Outcome::Succeeded => {
                    self.pending = None;
                    self.sent = false;
                    self.choice = None;
                }
            }
        }
        let was = self.support().detected;
        self.view = view;
        let now = self.support().detected;
        // A choice still on the stored set follows it; one being edited stays.
        if self.choice.as_ref().is_some_and(|choice| *choice == was) {
            self.choice = None;
        }
        if self.choice.is_none() && self.view.state == LoadState::Ready {
            self.choice = Some(now);
        }
        cx.notify();
    }

    /// `Core::roles(community)`: the poster picker's roles until `ChannelOverwritesView::roles`
    /// lands.
    pub fn set_roles(&mut self, roles: RolesView, cx: &mut Context<Self>) {
        self.roles = roles;
        cx.notify();
    }

    /// Core's preset data (roles, detected preset, missing actions, default posters), once
    /// `ChannelOverwritesView` carries it; `None` uses `PresetSupport::fallback`.
    pub fn set_support(&mut self, support: Option<PresetSupport>, cx: &mut Context<Self>) {
        self.support = support;
        cx.notify();
    }

    /// `BuiltPreset::auto_allowed_role_ids` for the current choice, from `Preview`.
    pub fn set_kept(&mut self, kept: Option<Vec<String>>, cx: &mut Context<Self>) {
        self.kept = kept;
        cx.notify();
    }

    fn support(&self) -> PresetSupport {
        self.support
            .clone()
            .unwrap_or_else(|| PresetSupport::fallback(&self.view.overwrites, &self.roles))
    }

    fn busy(&self) -> bool {
        self.sent && self.view.op.busy
    }

    fn set_choice(&mut self, choice: PresetChoice, cx: &mut Context<Self>) {
        if self.choice.as_ref() == Some(&choice) {
            return;
        }
        self.choice = Some(choice.clone());
        self.kept = None;
        cx.emit(ChannelOverridesEvent::Preview {
            channel_id: self.channel_id.clone(),
            choice,
        });
        cx.notify();
    }

    pub(crate) fn choose(&mut self, card: Card, cx: &mut Context<Self>) {
        let Some(choice) = self.choice.clone() else {
            return;
        };
        let support = self.support();
        if !self.view.editable
            || self.busy()
            || card_block(card, choice.card, support.missing_for(card)).is_some()
            || !card.builds()
        {
            return;
        }
        self.set_choice(choose_card(&choice, card, &support.default_posters), cx);
    }

    pub(crate) fn toggle_poster(&mut self, role_id: &str, cx: &mut Context<Self>) {
        let Some(choice) = self.choice.clone() else {
            return;
        };
        let pickable = self
            .support()
            .roles
            .iter()
            .any(|role| role.id == role_id && role.below_me);
        if !self.view.editable || self.busy() || !pickable {
            return;
        }
        self.set_choice(toggle_poster(&choice, role_id), cx);
    }

    pub(crate) fn set_attach(&mut self, on: bool, cx: &mut Context<Self>) {
        let Some(mut choice) = self.choice.clone() else {
            return;
        };
        if !self.view.editable || self.busy() {
            return;
        }
        choice.members_can_attach = on;
        self.set_choice(choice, cx);
    }

    pub(crate) fn save(&mut self, cx: &mut Context<Self>) {
        let Some(choice) = self.choice.clone() else {
            return;
        };
        if !self.view.editable || self.busy() || !preset_dirty(&choice, &self.support().detected)
        {
            return;
        }
        self.sent = true;
        self.pending = Some(Pending::new(()));
        cx.emit(ChannelOverridesEvent::Save {
            channel_id: self.channel_id.clone(),
            choice,
        });
        cx.notify();
    }

    /// As if Save had been pressed: for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn mark_sent(&mut self) {
        self.sent = true;
        self.pending = Some(Pending::new(()));
    }

    fn card_view(
        &self,
        card: Card,
        choice: &PresetChoice,
        support: &PresetSupport,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let block = card_block(card, choice.card, support.missing_for(card));
        let locked = if !self.view.editable {
            Some(needs("MANAGE_CHANNEL_PERMISSIONS"))
        } else {
            block.clone()
        };
        let selected = choice.card == card;
        let disabled = locked.is_some() && !selected;
        let icon = match card {
            Card::Normal => DesignIcon::Tag,
            Card::ReadOnly => DesignIcon::Visibility,
            Card::Announcement => DesignIcon::Campaign,
            Card::ModsOnly => DesignIcon::ShieldOutlined,
            Card::Custom => DesignIcon::Tune,
        };
        let border = if selected { sem.primary } else { sem.divider };
        let element = div()
            .id(SharedString::from(format!("preset-{}", card.key())))
            .test_support()
            .role(Role::RadioButton)
            .aria_label(card.title())
            .flex()
            .items_start()
            .gap(spacing(1.5))
            .p(spacing(1.5))
            .rounded(px(8.))
            .border_2()
            .border_color(border)
            .when(selected, |c| c.bg(sem.primary.opacity(0.08)))
            .when(disabled, |c| c.opacity(0.55))
            .when(!disabled && !selected, |c| {
                c.cursor_pointer().hover(|s| s.bg(sem.action_hover))
            })
            .child(design_icon(
                icon,
                22.,
                if selected { sem.primary } else { sem.text_secondary },
            ))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        text(Variant::Subtitle2, card.title())
                            .font_weight(FontWeight(600.))
                            .text_color(sem.text_primary),
                    )
                    .child(text(Variant::Caption, card.description()).text_color(sem.text_secondary))
                    .when_some(
                        block.filter(|_| card != Card::ModsOnly && !selected),
                        |c, reason| {
                            c.child(
                                text(Variant::Caption, reason)
                                    .text_color(sem.text_secondary)
                                    .italic(),
                            )
                        },
                    ),
            )
            .when(!disabled, |c| {
                c.on_click(cx.listener(move |view, _, _, cx| view.choose(card, cx)))
            });
        match locked.filter(|_| disabled) {
            Some(reason) => with_tip(element, reason).into_any_element(),
            None => element.into_any_element(),
        }
    }

    fn posters(
        &self,
        choice: &PresetChoice,
        support: &PresetSupport,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let kept = kept_roles(support, choice, self.kept.as_deref());
        let editable = self.view.editable && !self.busy();
        let chips: Vec<AnyElement> = support
            .roles
            .iter()
            .filter(|role| role.below_me || kept.contains(&role.id))
            .map(|role| {
                let on = choice.post_role_ids.contains(&role.id);
                let base = div()
                    .id(SharedString::from(format!("poster-{}", role.id)))
                    .test_support()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .h(px(32.))
                    .px(spacing(1.5))
                    .rounded(px(16.))
                    .border_1();
                if role.below_me {
                    let id = role.id.clone();
                    base.role(Role::Button)
                        .aria_label(role.name.clone())
                        .border_color(if on { sem.primary } else { sem.divider })
                        .when(on, |c| {
                            c.bg(sem.primary.opacity(0.12))
                                .child(design_icon(DesignIcon::Check, 16., sem.primary))
                        })
                        .when(editable, |c| {
                            c.cursor_pointer()
                                .hover(|s| s.bg(sem.action_hover))
                                .on_click(cx.listener(move |view, _, _, cx| {
                                    view.toggle_poster(&id, cx)
                                }))
                        })
                        .when(!editable, |c| c.opacity(0.6))
                        .child(
                            text(Variant::Body2, role.name.clone())
                                .text_color(if on { sem.primary } else { sem.text_primary }),
                        )
                        .into_any_element()
                } else {
                    with_tip(
                        base.role(Role::Note)
                            .aria_label(format!("{} (kept automatically)", role.name))
                            .border_color(sem.divider)
                            .bg(sem.chip_bg)
                            .child(design_icon(DesignIcon::Lock, 14., sem.text_secondary))
                            .child(
                                text(Variant::Body2, role.name.clone())
                                    .text_color(sem.text_secondary),
                            ),
                        "Kept automatically: this role ranks at or above yours",
                    )
                    .into_any_element()
                }
            })
            .collect();
        let none = chips.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .child(text(Variant::Subtitle2, "Roles that can post").text_color(sem.text_primary))
            .child(
                div()
                    .id("posters")
                    .test_support()
                    .flex()
                    .flex_wrap()
                    .gap(spacing(1.))
                    .children(chips),
            )
            .when(none, |c| {
                c.child(
                    text(Variant::Caption, "No roles below yours to choose from.")
                        .text_color(sem.text_secondary),
                )
            })
            .when(!kept.is_empty(), |c| {
                c.child(
                    text(
                        Variant::Caption,
                        "Locked roles rank at or above yours and keep what they have.",
                    )
                    .text_color(sem.text_secondary),
                )
            })
            .into_any_element()
    }

    /// A stored set no preset makes, in plain words. The advanced matrix replaces this later.
    fn custom_section(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let lines = summarize(&self.view.overwrites);
        div()
            .id("overrides-custom")
            .test_support()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .p(spacing(1.5))
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .child(
                text(Variant::Subtitle2, "This channel has custom permissions")
                    .text_color(sem.text_primary),
            )
            .children(lines.into_iter().map(|line| {
                text(Variant::Body2, line)
                    .text_color(sem.text_primary)
                    .min_w_0()
            }))
            .child(
                text(
                    Variant::Caption,
                    "Pick a preset above to replace them.",
                )
                .text_color(sem.text_secondary),
            )
            .into_any_element()
    }
}

impl Render for ChannelOverrides {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let narrow = phone(window);
        let root = div()
            .id("channel-overrides")
            .test_support()
            .role(Role::Region)
            .aria_label("Channel permissions")
            .w_full()
            .flex()
            .flex_col()
            .gap(spacing(2.5))
            .pt(spacing(1.));
        match &self.view.state {
            LoadState::Loading => {
                return root
                    .items_center()
                    .py(spacing(4.))
                    .child(Spinner::new("overrides-loading").size(28.))
                    .into_any_element();
            }
            LoadState::Failed { error } => {
                return root
                    .child(Alert::new(
                        Severity::Error,
                        format!("Couldn't load this channel's permissions: {}", error.message),
                    ))
                    .into_any_element();
            }
            LoadState::Ready => {}
        }
        let support = self.support();
        let choice = self.choice.clone().unwrap_or_else(|| support.detected.clone());
        let stored = support.detected.clone();
        let card_views: Vec<AnyElement> = cards(stored.card, choice.card)
            .into_iter()
            .map(|card| self.card_view(card, &choice, &support, cx))
            .collect();
        let grid = div()
            .id("presets")
            .test_support()
            .role(Role::RadioGroup)
            .aria_label("Channel permission preset")
            .grid()
            .grid_cols(if narrow { 1 } else { 2 })
            .gap(spacing(1.))
            .children(card_views);
        let busy = self.busy();
        let dirty = preset_dirty(&choice, &stored);
        let entity = cx.weak_entity();
        let attach = (choice.card == Card::Normal).then(|| {
            Switch::new(
                "overrides-attach",
                "Members can attach files",
                choice.members_can_attach,
            )
            .disabled(!self.view.editable || busy)
            .on_change(move |on, _, cx| {
                entity.update(cx, |view, cx| view.set_attach(on, cx)).ok();
            })
        });
        let posters = choice
            .card
            .has_posters()
            .then(|| self.posters(&choice, &support, cx));
        let custom = (choice.card == Card::Custom).then(|| self.custom_section(cx));
        let error = self
            .sent
            .then(|| server_error(self.view.op.error.as_ref()))
            .flatten();
        root.when(!self.view.editable, |root| {
            root.child(locked_note(
                "overrides-locked",
                needs("MANAGE_CHANNEL_PERMISSIONS"),
                cx,
            ))
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(text(Variant::Subtitle2, "Channel type").text_color(sem.text_primary))
                .child(grid),
        )
        .children(custom)
        .children(posters)
        .children(attach)
        .children(error)
        .child(
            div().flex().justify_end().child(
                Button::new("overrides-save", "Save permissions")
                    .contained()
                    .loading(busy)
                    .disabled(!dirty || busy || !self.view.editable)
                    .on_click(cx.listener(|view, _, _, cx| view.save(cx))),
            ),
        )
        .into_any_element()
    }
}
