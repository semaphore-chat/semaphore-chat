//! Every primitive, so a screenshot reviews them all at once, in any theme.

use super::{
    Alert, Avatar, Badge, Button, ButtonSize, ButtonTone, CheckState, Checkbox, Chip, Dialog, Icon,
    IconButton, LinearProgress, ListRow, Paper, Radio, SecondaryTone, SelectField, Severity,
    Skeleton, Slider, Snackbar, Spinner, Switch, Table, Tabs, TextField, Tip, Variant, link,
    select_state, text, text_state,
};
use super::{Menu as KitMenu, MenuItem as KitMenuItem};
use crate::stories::Story;
use crate::theme::{FONT_FAMILY, SemTheme};
use gpui_kit::component::input::InputState;
use gpui_kit::component::select::SelectState;
use gpui_kit::component::slider::SliderState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as I;

struct Gallery {
    username: Entity<InputState>,
    filled: Entity<InputState>,
    failed: Entity<InputState>,
    choice: Entity<SelectState<Vec<SharedString>>>,
    volume: Entity<SliderState>,
    switched: bool,
    checked: bool,
    radio: usize,
    tab: usize,
    dialog: bool,
}

impl Gallery {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filled = text_state(window, cx, false);
        filled.update(cx, |state, cx| state.set_value("mike", window, cx));
        Self {
            username: text_state(window, cx, false),
            filled,
            failed: text_state(window, cx, false),
            choice: select_state(
                vec!["Ocean Teal".into(), "Sky Blue".into(), "Deep Indigo".into()],
                Some(1),
                window,
                cx,
            ),
            volume: cx.new(|_| SliderState::new().min(0.).max(100.).default_value(60.)),
            switched: true,
            checked: true,
            radio: 0,
            tab: 0,
            dialog: false,
        }
    }
}

fn section(title: &'static str, secondary: Hsla, body: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .child(text(Variant::SectionLabel, title).text_color(secondary))
        .child(body)
}

fn row() -> Div {
    div().flex().flex_wrap().items_center().gap(px(8.))
}

impl Render for Gallery {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let secondary = sem.text_secondary;
        let primary = sem.text_primary;
        let view = cx.entity().downgrade();

        let left = div()
            .w(px(420.))
            .flex_shrink_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(section(
                "Typography",
                secondary,
                div()
                    .flex()
                    .flex_col()
                    .child(text(Variant::H5, "Heading five"))
                    .child(text(Variant::H6, "Heading six"))
                    .child(text(Variant::Body1, "Body one, as messages use"))
                    .child(text(Variant::ListItem, "List item, channel names"))
                    .child(text(Variant::Meta, "Meta, timestamps").text_color(secondary))
                    .child(div().flex().child(link("link", "A link", cx, |_, _| {}))),
            ))
            .child(section(
                "Buttons",
                secondary,
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        row()
                            .child(Button::new("b1", "Contained").contained())
                            .child(Button::new("b2", "Outlined").outlined())
                            .child(Button::new("b3", "Text")),
                    )
                    .child(
                        row()
                            .child(
                                Button::new("b4", "Open")
                                    .contained()
                                    .start_icon(I::OpenInBrowser)
                                    .size(ButtonSize::Large),
                            )
                            .child(Button::new("b5", "Disabled").contained().disabled(true))
                            .child(Button::new("b6", "Saving").outlined().loading(true))
                            .child(Button::new("open-dialog", "Dialog").outlined().on_click({
                                let view = view.clone();
                                move |_, _, cx| {
                                    view.update(cx, |this, cx| {
                                        this.dialog = true;
                                        cx.notify();
                                    })
                                    .ok();
                                }
                            })),
                    )
                    .child(
                        row()
                            .child(Button::new("b7", "Saving").contained().loading(true))
                            .child(Button::new("b8", "Delete").contained().tone(ButtonTone::Danger))
                            .child(
                                Button::new("b9", "Timeout")
                                    .contained()
                                    .tone(ButtonTone::Warning),
                            ),
                    )
                    .child(
                        row()
                            .child(
                                Button::new("b10", "Delete")
                                    .contained()
                                    .tone(ButtonTone::Danger)
                                    .disabled(true),
                            )
                            .child(
                                Button::new("b11", "Timeout")
                                    .contained()
                                    .tone(ButtonTone::Warning)
                                    .disabled(true),
                            )
                            .child(
                                Button::new("b12", "Deleting")
                                    .contained()
                                    .tone(ButtonTone::Danger)
                                    .loading(true),
                            )
                            .child(
                                Button::new("b13", "Timing out")
                                    .contained()
                                    .tone(ButtonTone::Warning)
                                    .loading(true),
                            ),
                    )
                    .child(
                        row()
                            .child(IconButton::new("i1", I::Search, "Search"))
                            .child(IconButton::new("i2", I::Settings, "Settings").small())
                            .child(IconButton::new("i3", I::PushPin, "Pin").selected(true))
                            .child(IconButton::new("i4", I::Delete, "Delete").disabled(true))
                            .child(Icon::new(I::Campaign).color(sem.primary))
                            .child(Icon::new(I::MicOff).size(18.).color(sem.negative)),
                    ),
            ))
            .child(section(
                "Fields",
                secondary,
                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .pt(px(6.))
                    .child(
                        TextField::new("username", &self.username, "Username")
                            .required(true)
                            .surface(sem.background_default),
                    )
                    .child(
                        TextField::new("filled", &self.filled, "Filled")
                            .helper("A helper line")
                            .surface(sem.background_default),
                    )
                    .child(
                        TextField::new("failed", &self.failed, "Server URL")
                            .error(true)
                            .helper("Couldn't reach that server")
                            .surface(sem.background_default),
                    )
                    .child(
                        SelectField::new("accent", &self.choice, "Accent")
                            .surface(sem.background_default),
                    ),
            ))
            .child(section(
                "Selection",
                secondary,
                div()
                    .flex()
                    .flex_col()
                    .child(
                        row()
                            .child(Switch::new("s1", "On", self.switched).on_change({
                                let view = view.clone();
                                move |value, _, cx| {
                                    view.update(cx, |this, cx| {
                                        this.switched = value;
                                        cx.notify();
                                    })
                                    .ok();
                                }
                            }))
                            .child(Switch::new("s2", "Off", false))
                            .child(Switch::new("s3", "Disabled", true).disabled(true))
                            .child(Checkbox::new("c1", "Checked", self.checked).on_change({
                                let view = view.clone();
                                move |value, _, cx| {
                                    view.update(cx, |this, cx| {
                                        this.checked = value;
                                        cx.notify();
                                    })
                                    .ok();
                                }
                            }))
                            .child(Checkbox::new("c2", "Off", false)),
                    )
                    .child(
                        div()
                            .w(px(300.))
                            .flex()
                            .flex_col()
                            .child(Checkbox::new("c3", "Partly selected", false)
                                .state(CheckState::Indeterminate))
                            .child(
                                Checkbox::new("c4", "Granted", true)
                                    .caption("CREATE_MESSAGE"),
                            )
                            .child(
                                Checkbox::new(
                                    "c5",
                                    "A label long enough that it has to wrap onto several lines before the row runs out of width",
                                    true,
                                )
                                .caption("And a caption under the label, muted and smaller"),
                            )
                            .child(
                                Checkbox::new("c6", "Partly selected, off", false)
                                    .state(CheckState::Indeterminate)
                                    .caption("You don't have permission")
                                    .disabled(true),
                            )
                            .child(Checkbox::new("c7", "Box only", false).hide_label()),
                    )
                    .child(row().children((0..3).map(|index| {
                        let view = view.clone();
                        Radio::new(
                            ("radio", index),
                            ["One", "Two", "Three"][index],
                            self.radio == index,
                        )
                        .on_select(move |_, cx| {
                            view.update(cx, |this, cx| {
                                this.radio = index;
                                cx.notify();
                            })
                            .ok();
                        })
                    })))
                    .child(
                        div()
                            .w(px(240.))
                            .py(px(8.))
                            .child(Slider::new(&self.volume, "Volume")),
                    ),
            ));

        let right = div()
            .flex_1()
            .min_w(px(360.))
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(section(
                "Tabs",
                secondary,
                Tabs::new(
                    "tabs",
                    vec!["Overview".into(), "Members".into(), "Roles".into()],
                    self.tab,
                )
                .on_select({
                    let view = view.clone();
                    move |index, _, cx| {
                        view.update(cx, |this, cx| {
                            this.tab = index;
                            cx.notify();
                        })
                        .ok();
                    }
                }),
            ))
            .child(section(
                "List rows",
                secondary,
                Paper::new()
                    .p(px(8.))
                    .child(
                        ListRow::new("l1", "Selected row")
                            .selected(true)
                            .leading(Icon::new(I::Tag).size(18.).color(sem.primary)),
                    )
                    .child(
                        ListRow::new("l2", "A row with a very long name that has to stop before the badge at its end")
                            .secondary("And a secondary line")
                            .leading(Avatar::new("AB").size(32.).background(sem.primary))
                            .trailing(Badge::new(3).compact()),
                    )
                    .child(ListRow::new("l3", "Disabled row").disabled(true)),
            ))
            .child(section(
                "Avatars, badges and chips",
                secondary,
                row()
                    .gap(px(16.))
                    .child(Badge::new(32).on(Avatar::new("MI").size(48.)))
                    .child(Badge::new(150).on(Avatar::new("NC").background(sem.warning)))
                    .child(Avatar::new("PF").size(32.).background(sem.success))
                    .child(Chip::new("Connected"))
                    .child(Chip::new("With icon").icon(Icon::new(I::Check).size(16.)))
                    .child(Badge::new(7)),
            ))
            .child(section(
                "Progress and skeleton",
                secondary,
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .child(LinearProgress::new("p1", Some(60.), "Upload"))
                    .child(
                        row()
                            .gap(px(16.))
                            .child(Spinner::new("spin").size(32.))
                            .child(Skeleton::circle("sk1", 32.))
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.))
                                    .child(Skeleton::rect("sk2", relative(0.6), 14.))
                                    .child(Skeleton::rect("sk3", relative(0.4), 12.)),
                            ),
                    ),
            ))
            .child(section(
                "Alerts",
                secondary,
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(Alert::new(Severity::Error, "Login failed. Please try again."))
                    .child(Alert::new(Severity::Warning, "Your session expires soon."))
                    .child(Alert::new(Severity::Info, "You've been signed out."))
                    .child(Alert::new(Severity::Success, "Saved.")),
            ))
            .child(section(
                "Table",
                secondary,
                Paper::new().child(Table::new(
                    "Members",
                    vec!["Name".into(), "Role".into(), "Joined".into()],
                    vec![
                        vec!["Mike".into(), "Owner".into(), "Sep 16".into()],
                        vec!["Priya Nilsson".into(), "Member".into(), "Sep 18".into()],
                    ],
                )),
            ))
            .child(section(
                "Menu, tooltip and snackbar",
                secondary,
                row()
                    .gap(px(16.))
                    .items_start()
                    .child(KitMenu::new(
                        "Actions",
                        vec![
                        KitMenuItem::new("m1", "Edit", |_, _| {}),
                        KitMenuItem::new("m2", "Disabled", |_, _| {}).disabled(true),
                        KitMenuItem::new("m3", "Delete", |_, _| {}).destructive(),
                        KitMenuItem::new("m4", "Kick", |_, _| {}).icon(I::PersonRemove),
                        KitMenuItem::new("m5", "Timeout", |_, _| {})
                            .icon(I::Timer)
                            .secondary("Last try failed: the call timed out")
                            .secondary_tone(SecondaryTone::Error),
                        KitMenuItem::new("m6", "Ban", |_, _| {})
                            .icon(I::Block)
                            .destructive()
                            .secondary("You don't have permission")
                            .disabled(true),
                        KitMenuItem::new("m7", "Pin message", |_, _| {})
                            .icon(I::PushPin)
                            .secondary("In progress\u{2026}")
                            .min_height(48.),
                    ],
                    ))
                    .child(cx.new(|_| Tip("A tooltip".into())))
                    .child(
                        Snackbar::new("Message sent")
                            .action(Button::new("undo", "Undo")),
                    ),
            ));

        div()
            .id("gallery")
            .relative()
            .size_full()
            .font_family(FONT_FAMILY)
            .bg(sem.background_default)
            .text_color(primary)
            .child(
                div()
                    .id("gallery-scroll")
                    .size_full()
                    .overflow_y_scroll()
                    .p(px(24.))
                    .flex()
                    .flex_wrap()
                    .gap(px(32.))
                    .child(left)
                    .child(right),
            )
            .when(self.dialog, |gallery| {
                let view = view.clone();
                let close = view.clone();
                gallery.child(
                    Dialog::new("Leave this community?")
                        .body(text(
                            Variant::Body1,
                            "You'll lose access to its channels until someone invites you back.",
                        ))
                        .action(
                            Button::new("dialog-cancel", "Cancel").on_click(move |_, _, cx| {
                                view.update(cx, |this, cx| {
                                    this.dialog = false;
                                    cx.notify();
                                })
                                .ok();
                            }),
                        )
                        .action(Button::new("dialog-ok", "Leave").color(sem.error))
                        .on_close(move |_, cx| {
                            close
                                .update(cx, |this, cx| {
                                    this.dialog = false;
                                    cx.notify();
                                })
                                .ok();
                        }),
                )
            })
    }
}

pub fn stories() -> Vec<Story> {
    vec![Story::new("kit-gallery", |_, window, cx| {
        cx.new(|cx| Gallery::new(window, cx)).into()
    })]
}
