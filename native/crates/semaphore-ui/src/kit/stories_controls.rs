//! The controls and fields in every state the web kit's stories show (`frontend/src/stories/kit/`),
//! named as the web names them (`kit-button-states` is `kit-button--states`), in dark, light and
//! tinted (vibrant) colour.

use super::look::{c, styled_text};
use super::{
    Button, ButtonVariant, CheckState, Checkbox, ControlSize, FieldShape, IconButton,
    IconButtonVariant, KeyCap, Orientation, RadioGroup, RadioOption, SelectField, Slider, Surface,
    Switch, TabItem, Tabs, TextField, select_state, text_state,
};
use crate::stories::Story;
use crate::theme::{DEFAULT_BASE, SemTheme, ThemeInput};
use gpui_kit::component::input::InputState;
use gpui_kit::component::select::SelectState;
use gpui_kit::component::slider::SliderState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as I;
use semaphore_design::lounge::{
    LAYOUT_GUTTER, RADIUS_CARD, RADIUS_ISLAND, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL, TEXT_META,
};
use semaphore_design::{Intensity, LoungeIcon, Mode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Which {
    ButtonVariants,
    ButtonStates,
    ButtonLongLabel,
    ButtonFocused(ButtonVariant),
    IconButtonVariants,
    IconButtonStates,
    IconButtonFocused,
    KeyCaps,
    TabsUnderline,
    TabsSegmented,
    TabsCounts,
    TabsOverflow,
    TabsLastSelected,
    SwitchStates,
    SwitchFocused,
    SwitchLongLabel,
    CheckboxStates,
    CheckboxFocused,
    CheckboxLongLabel,
    RadioStates,
    RadioFocused,
    RadioLongLabel,
    SliderStates,
    SliderFormatted,
    SliderLongLabel,
    TextFieldStates,
    TextFieldShapes,
    TextFieldNarrow,
    SelectStates,
    SelectFocused,
    SelectLongOptions,
}

struct Controls {
    which: Which,
    focus: FocusHandle,
    texts: Vec<Entity<InputState>>,
    selects: Vec<Entity<SelectState<Vec<SharedString>>>>,
    sliders: Vec<Entity<SliderState>>,
}

fn texts(values: &[&str], window: &mut Window, cx: &mut App) -> Vec<Entity<InputState>> {
    values
        .iter()
        .map(|value| {
            let state = text_state(window, cx, false);
            if !value.is_empty() {
                let value = value.to_string();
                state.update(cx, |state, cx| state.set_value(value, window, cx));
            }
            state
        })
        .collect()
}

fn options(labels: &[&str]) -> Vec<SharedString> {
    labels
        .iter()
        .map(|label| SharedString::from(label.to_string()))
        .collect()
}

const ACCENTS: [&str; 3] = ["Ocean Teal", "Sky Blue", "Deep Indigo"];

impl Controls {
    fn new(which: Which, window: &mut Window, cx: &mut App) -> Self {
        let focus = cx.focus_handle();
        let texts = match which {
            Which::TextFieldStates => texts(
                &["", "mike", "mike", "not a url", "", "Locked", ""],
                window,
                cx,
            ),
            Which::TextFieldShapes => texts(&["", "Search"], window, cx),
            Which::TextFieldNarrow => texts(
                &["A display name long enough to need more room than it has"],
                window,
                cx,
            ),
            _ => Vec::new(),
        };
        let selects = match which {
            Which::SelectStates => vec![
                select_state(options(&ACCENTS), Some(1), window, cx),
                select_state(options(&ACCENTS), None, window, cx),
                select_state(options(&ACCENTS), Some(0), window, cx),
                select_state(options(&ACCENTS), None, window, cx),
                select_state(options(&ACCENTS), Some(2), window, cx),
            ],
            Which::SelectFocused => vec![select_state(options(&ACCENTS), Some(1), window, cx)],
            Which::SelectLongOptions => vec![select_state(
                options(&[
                    "An option whose label is far longer than the field is wide",
                    "Short",
                    "Another long option, to show how the list wraps or cuts its text",
                ]),
                Some(0),
                window,
                cx,
            )],
            _ => Vec::new(),
        };
        let slider = |value: f32, cx: &mut App| {
            cx.new(|_| SliderState::new().min(0.).max(100.).default_value(value))
        };
        let sliders = match which {
            Which::SliderStates => vec![
                slider(60., cx),
                slider(80., cx),
                slider(30., cx),
                slider(45., cx),
            ],
            Which::SliderFormatted | Which::SliderLongLabel => vec![slider(80., cx)],
            _ => Vec::new(),
        };
        let this = Self {
            which,
            focus,
            texts,
            selects,
            sliders,
        };
        // A focused story focuses its control as a keyboard user would land on it: the handle,
        // then a key press, so the focus ring (keyboard focus only) shows.
        let keyboard = |window: &mut Window, cx: &mut App| {
            if let Ok(key) = Keystroke::parse("f13") {
                window.dispatch_keystroke(key, cx);
            }
        };
        match which {
            Which::ButtonFocused(_)
            | Which::IconButtonFocused
            | Which::SwitchFocused
            | Which::CheckboxFocused
            | Which::RadioFocused => {
                let handle = this.focus.clone();
                window.defer(cx, move |window, cx| {
                    handle.focus(window, cx);
                    keyboard(window, cx);
                });
            }
            Which::TextFieldStates => {
                let state = this.texts[0].clone();
                window.defer(cx, move |window, cx| {
                    state.update(cx, |state, cx| state.focus(window, cx));
                });
            }
            Which::SelectFocused => {
                let state = this.selects[0].clone();
                window.defer(cx, move |window, cx| {
                    state.update(cx, |state, cx| state.focus(window, cx));
                });
            }
            _ => {}
        }
        this
    }
}

fn caption(label: &'static str, cx: &App) -> Div {
    styled_text(TEXT_META, label).text_color(c(cx.sem().roles.text_secondary))
}

fn row() -> Div {
    div().flex().flex_wrap().items_center().gap(px(SPACE_MD))
}

fn column() -> Div {
    div().flex().flex_col().gap(px(SPACE_LG))
}

/// A card inside the island, for the pieces drawn on `fill`.
fn card(cx: &App, body: impl IntoElement) -> Div {
    div()
        .p(px(SPACE_LG))
        .rounded(px(RADIUS_CARD))
        .bg(c(cx.sem().roles.fill))
        .child(body)
}

fn variant_buttons(prefix: &'static str, size: ControlSize, on: Surface) -> Div {
    row().children(ButtonVariant::ALL.into_iter().map(move |variant| {
        Button::new(
            ElementId::named_usize(format!("{prefix}-{}", variant.name()), size as usize),
            variant.name(),
        )
        .variant(variant)
        .size(size)
        .on_surface(on)
    }))
}

impl Render for Controls {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.sem().roles;
        let cx: &App = cx;
        let body: AnyElement = match self.which {
            Which::ButtonVariants => column()
                .children(ControlSize::ALL.into_iter().map(|size| {
                    variant_buttons("variant", size, Surface::Surface)
                }))
                .child(
                    row()
                        .child(Button::new("icon-primary", "Open").primary().start_icon(I::OpenInBrowser))
                        .child(Button::new("icon-soft", "Add").start_icon(I::Add)),
                )
                .child(caption("On a card", cx))
                .child(card(cx, variant_buttons("card", ControlSize::Md, Surface::Fill)))
                .into_any_element(),
            Which::ButtonStates => column()
                .children(ButtonVariant::ALL.into_iter().map(|variant| {
                    let id = |state: &str| ElementId::Name(format!("{}-{state}", variant.name()).into());
                    row()
                        .child(Button::new(id("rest"), variant.name()).variant(variant))
                        .child(Button::new(id("disabled"), "Disabled").variant(variant).disabled(true))
                        .child(Button::new(id("loading"), "Saving").variant(variant).loading(true))
                        .child(
                            Button::new(id("loading-icon"), "Sending")
                                .variant(variant)
                                .start_icon(I::Send)
                                .loading(true),
                        )
                        .child(Button::new(id("unavailable"), "Unavailable").variant(variant).unavailable(true))
                }))
                .into_any_element(),
            Which::ButtonLongLabel => column()
                .child(
                    div().w(px(180.)).child(
                        Button::new("long", "Save changes to every channel in this community").primary(),
                    ),
                )
                .child(
                    div().w(px(320.)).child(
                        Button::new("long-full", "Continue to the next step").full_width().primary(),
                    ),
                )
                .into_any_element(),
            Which::ButtonFocused(variant) => row()
                .child(
                    Button::new("focused", variant.name())
                        .variant(variant)
                        .track_focus(&self.focus),
                )
                .child(Button::new("beside", "Beside").variant(variant))
                .into_any_element(),
            Which::IconButtonVariants => column()
                .children(IconButtonVariant::ALL.into_iter().map(|variant| {
                    row().children(ControlSize::ALL.into_iter().map(move |size| {
                        IconButton::new(
                            ElementId::named_usize(format!("ib-{variant:?}"), size as usize),
                            I::Settings,
                            "Settings",
                        )
                        .variant(variant)
                        .size(size)
                    }))
                }))
                .child(caption("Selected", cx))
                .child(row().children(ControlSize::ALL.into_iter().map(|size| {
                    IconButton::new(ElementId::named_usize("ib-selected", size as usize), I::PushPin, "Pin")
                        .size(size)
                        .selected(true)
                })))
                .child(caption("On a card", cx))
                .child(card(
                    cx,
                    row().children(IconButtonVariant::ALL.into_iter().map(|variant| {
                        IconButton::new(ElementId::Name(format!("ib-card-{variant:?}").into()), I::Settings, "Settings")
                            .variant(variant)
                            .on_surface(Surface::Fill)
                    })).child(
                        IconButton::new("ib-card-selected", I::PushPin, "Pin").selected(true).on_surface(Surface::Fill),
                    ),
                ))
                .into_any_element(),
            Which::IconButtonStates => column()
                .children(IconButtonVariant::ALL.into_iter().map(|variant| {
                    let id = |state: &str| ElementId::Name(format!("ib-{variant:?}-{state}").into());
                    row()
                        .child(IconButton::new(id("rest"), I::Mic, "Mute").variant(variant))
                        .child(IconButton::new(id("disabled"), I::Mic, "Mute").variant(variant).disabled(true))
                        .child(IconButton::new(id("loading"), I::Mic, "Mute").variant(variant).loading(true))
                        .child(IconButton::new(id("unavailable"), I::Mic, "Mute").variant(variant).unavailable(true))
                        .child(IconButton::new(id("selected"), I::Mic, "Mute").variant(variant).selected(true))
                }))
                .into_any_element(),
            Which::IconButtonFocused => row()
                .child(IconButton::new("ib-focused", I::Settings, "Settings").track_focus(&self.focus))
                .child(IconButton::new("ib-beside", I::PushPin, "Pin").variant(IconButtonVariant::Soft))
                .into_any_element(),
            Which::KeyCaps => column()
                .child(row().children(["Ctrl", "K", "Esc", "Shift", "Enter", "\u{2191}"].map(KeyCap::new)))
                .child(caption("On a card", cx))
                .child(card(cx, row().children(["Ctrl", "K"].map(|key| KeyCap::new(key).on_surface(Surface::Fill)))))
                .into_any_element(),
            Which::TabsUnderline => column()
                .child(Tabs::new("tabs-underline", options(&["Overview", "Members", "Roles"]), 0))
                .child(Tabs::new("tabs-underline-full", options(&["All", "Unread"]), 1).full_width())
                .into_any_element(),
            Which::TabsSegmented => column()
                .child(div().flex().child(Tabs::new("tabs-segmented", options(&["Day", "Week", "Month"]), 1).segmented()))
                .child(Tabs::new("tabs-segmented-full", options(&["All", "Unread"]), 0).segmented().full_width())
                .child(caption("On a card", cx))
                .child(card(cx, div().flex().child(Tabs::new("tabs-card", options(&["Day", "Week"]), 0).segmented().on_surface(Surface::Fill))))
                .into_any_element(),
            Which::TabsCounts => {
                let items = || {
                    vec![
                        TabItem::new("All").count(12),
                        TabItem::new("Mentions").count(3),
                        TabItem::new("Archived").disabled(true),
                    ]
                };
                column()
                    .child(Tabs::items("tabs-counts", items(), 1))
                    .child(div().flex().child(Tabs::items("tabs-counts-seg", items(), 0).segmented()))
                    .into_any_element()
            }
            Which::TabsOverflow => div()
                .w(px(300.))
                .child(Tabs::new(
                    "tabs-overflow",
                    options(&["Overview", "Members", "Roles", "Channels", "Emoji", "Invites"]),
                    1,
                ))
                .into_any_element(),
            Which::TabsLastSelected => column()
                .child(Tabs::new("tabs-last", options(&["Overview", "Members", "Roles"]), 2))
                .child(div().flex().child(Tabs::new("tabs-last-seg", options(&["Day", "Week", "Month"]), 2).segmented()))
                .into_any_element(),
            Which::SwitchStates => column()
                .child(Switch::new("sw-on", "Notification sounds", true))
                .child(Switch::new("sw-off", "Desktop notifications", false))
                .child(Switch::new("sw-description", "Close to tray", true).description("Keep running in the tray when the window closes"))
                .child(Switch::new("sw-disabled-on", "Disabled, on", true).disabled(true))
                .child(Switch::new("sw-disabled-off", "Disabled, off", false).disabled(true))
                .child(row().child(Switch::new("sw-hidden", "Hidden label", true).label_hidden()).child(caption("label hidden", cx)))
                .into_any_element(),
            Which::SwitchFocused => column()
                .child(Switch::new("sw-focused", "Notification sounds", true).track_focus(&self.focus))
                .into_any_element(),
            Which::SwitchLongLabel => div()
                .w(px(320.))
                .child(
                    Switch::new("sw-long", "Load images from other sites in link previews and GIF search results", true)
                        .description("Other sites see your address when they serve the picture; turn this off to load nothing from them"),
                )
                .into_any_element(),
            Which::CheckboxStates => column()
                .child(Checkbox::new("cb-off", "Send messages", false))
                .child(Checkbox::new("cb-on", "Manage channels", true))
                .child(Checkbox::new("cb-mixed", "All text permissions", false).state(CheckState::Indeterminate))
                .child(Checkbox::new("cb-description", "Create invites", true).description("CREATE_INVITE"))
                .child(Checkbox::new("cb-disabled-off", "Disabled", false).disabled(true))
                .child(Checkbox::new("cb-disabled-on", "Disabled, checked", true).disabled(true))
                .child(row().child(Checkbox::new("cb-hidden", "Hidden label", true).label_hidden()).child(caption("label hidden", cx)))
                .child(card(cx, Checkbox::new("cb-card", "On a card", false).on_surface(Surface::Fill)))
                .into_any_element(),
            Which::CheckboxFocused => column()
                .child(Checkbox::new("cb-focused", "Manage channels", true).track_focus(&self.focus))
                .into_any_element(),
            Which::CheckboxLongLabel => div()
                .w(px(320.))
                .child(
                    Checkbox::new("cb-long", "Allow members with this role to mention everyone in every channel", true)
                        .description("MENTION_EVERYONE: notifies every member, including those who muted the channel"),
                )
                .into_any_element(),
            Which::RadioStates => {
                let sounds = || {
                    vec![
                        RadioOption::new("Default").description("The sound that came with the app"),
                        RadioOption::new("Soft"),
                        RadioOption::new("Retro").disabled(true),
                    ]
                };
                column()
                    .child(RadioGroup::new("radio-vertical", "Notification sound", sounds(), Some(0)))
                    .child(
                        RadioGroup::new("radio-horizontal", "Frame rate", vec![RadioOption::new("15 fps"), RadioOption::new("30 fps"), RadioOption::new("60 fps")], Some(1))
                            .orientation(Orientation::Horizontal),
                    )
                    .child(RadioGroup::new("radio-disabled", "Disabled group", sounds(), Some(1)).disabled(true))
                    .child(RadioGroup::new("radio-none", "Nothing chosen", sounds(), None))
                    .into_any_element()
            }
            Which::RadioFocused => RadioGroup::new(
                "radio-focused",
                "Notification sound",
                vec![RadioOption::new("Default"), RadioOption::new("Soft"), RadioOption::new("Retro")],
                Some(1),
            )
            .track_focus(&self.focus)
            .into_any_element(),
            Which::RadioLongLabel => div()
                .w(px(320.))
                .child(RadioGroup::new(
                    "radio-long",
                    "Who can send you direct messages from communities you share",
                    vec![
                        RadioOption::new("Everyone in a community you share with them, members and guests alike")
                            .description("Includes people you have never talked to"),
                        RadioOption::new("Friends only"),
                    ],
                    Some(0),
                ))
                .into_any_element(),
            Which::SliderStates => column()
                .w(px(320.))
                .child(Slider::new(&self.sliders[0], "Volume"))
                .child(Slider::new(&self.sliders[1], "Input sensitivity").format_value(|value| format!("{value:.0}%").into()))
                .child(Slider::new(&self.sliders[2], "Disabled").disabled(true))
                .child(Slider::new(&self.sliders[3], "Hidden label").label_hidden())
                .into_any_element(),
            Which::SliderFormatted => div()
                .w(px(320.))
                .child(Slider::new(&self.sliders[0], "Output volume").format_value(|value| format!("{value:.0}%").into()))
                .into_any_element(),
            Which::SliderLongLabel => div()
                .w(px(240.))
                .child(
                    Slider::new(&self.sliders[0], "How loud other people in the voice channel sound to you")
                        .format_value(|value| format!("{value:.0}%").into()),
                )
                .into_any_element(),
            Which::TextFieldStates => column()
                .w(px(360.))
                .child(TextField::new("tf-focused", &self.texts[0], "Username").placeholder("Your username"))
                .child(TextField::new("tf-filled", &self.texts[1], "Display name"))
                .child(TextField::new("tf-helper", &self.texts[2], "Username").helper("Letters, numbers and underscores"))
                .child(
                    TextField::new("tf-error", &self.texts[3], "Server URL")
                        .error(true)
                        .helper("Couldn't reach that server"),
                )
                .child(TextField::new("tf-required", &self.texts[4], "Email").required(true).placeholder("you@example.com"))
                .child(TextField::new("tf-disabled", &self.texts[5], "Disabled").disabled(true))
                .child(TextField::new("tf-hidden", &self.texts[6], "Search").label_hidden().placeholder("Label hidden").start_icon(LoungeIcon::Search))
                .into_any_element(),
            Which::TextFieldShapes => column()
                .w(px(360.))
                .child(TextField::new("tf-field", &self.texts[0], "Field").placeholder("The standard shape"))
                .child(
                    TextField::new("tf-round", &self.texts[1], "Round")
                        .shape(FieldShape::Round)
                        .start_icon(LoungeIcon::Search),
                )
                .child(card(cx, TextField::new("tf-card", &self.texts[0], "On a card").placeholder("Stands out from the card").on_surface(Surface::Fill)))
                .into_any_element(),
            Which::TextFieldNarrow => div()
                .w(px(200.))
                .child(
                    TextField::new("tf-narrow", &self.texts[0], "A label that is longer than the field is wide")
                        .helper("A helper line that has to wrap onto several lines"),
                )
                .into_any_element(),
            Which::SelectStates => column()
                .w(px(360.))
                .child(SelectField::new("sf-chosen", &self.selects[0], "Accent"))
                .child(SelectField::new("sf-placeholder", &self.selects[1], "Accent").placeholder("Pick an accent"))
                .child(SelectField::new("sf-helper", &self.selects[2], "Accent").helper("Used for buttons and links"))
                .child(SelectField::new("sf-error", &self.selects[3], "Accent").error(true).helper("Pick one").placeholder("Pick an accent"))
                .child(SelectField::new("sf-disabled", &self.selects[4], "Accent").disabled(true))
                .into_any_element(),
            Which::SelectFocused => div()
                .w(px(360.))
                .h(px(260.))
                .child(SelectField::new("sf-open", &self.selects[0], "Accent"))
                .into_any_element(),
            Which::SelectLongOptions => div()
                .w(px(280.))
                .child(SelectField::new("sf-long", &self.selects[0], "Option"))
                .into_any_element(),
        };
        div()
            .id("kit-controls")
            .size_full()
            .overflow_y_scroll()
            .bg(c(p.ground))
            .text_color(c(p.text))
            .p(px(LAYOUT_GUTTER))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(SPACE_SM))
                    .p(px(SPACE_XL))
                    .rounded(px(RADIUS_ISLAND))
                    .bg(c(p.surface))
                    .child(body),
            )
    }
}

fn theme(name: &str) -> ThemeInput {
    if name.ends_with("-light") {
        ThemeInput::new(DEFAULT_BASE, Mode::Light, Intensity::Minimal)
    } else if name.ends_with("-tinted") {
        ThemeInput::new(DEFAULT_BASE, Mode::Dark, Intensity::Vibrant)
    } else {
        ThemeInput::default()
    }
}

/// Every story: the web's name, and the state it draws. Each is built in its theme.
const STORIES: &[(&str, Which)] = &[
    ("kit-button-variants", Which::ButtonVariants),
    ("kit-button-variants-light", Which::ButtonVariants),
    ("kit-button-variants-tinted", Which::ButtonVariants),
    ("kit-button-states", Which::ButtonStates),
    ("kit-button-states-light", Which::ButtonStates),
    ("kit-button-long-label", Which::ButtonLongLabel),
    (
        "kit-button-focused",
        Which::ButtonFocused(ButtonVariant::Primary),
    ),
    (
        "kit-button-focused-ghost",
        Which::ButtonFocused(ButtonVariant::Ghost),
    ),
    (
        "kit-button-focused-danger",
        Which::ButtonFocused(ButtonVariant::Danger),
    ),
    (
        "kit-button-focused-light",
        Which::ButtonFocused(ButtonVariant::Primary),
    ),
    ("kit-icon-button-variants", Which::IconButtonVariants),
    ("kit-icon-button-variants-light", Which::IconButtonVariants),
    ("kit-icon-button-variants-tinted", Which::IconButtonVariants),
    ("kit-icon-button-states", Which::IconButtonStates),
    ("kit-icon-button-states-light", Which::IconButtonStates),
    ("kit-icon-button-focused", Which::IconButtonFocused),
    ("kit-key-cap-keys", Which::KeyCaps),
    ("kit-key-cap-keys-light", Which::KeyCaps),
    ("kit-tabs-underline", Which::TabsUnderline),
    ("kit-tabs-underline-light", Which::TabsUnderline),
    ("kit-tabs-segmented", Which::TabsSegmented),
    ("kit-tabs-segmented-light", Which::TabsSegmented),
    ("kit-tabs-segmented-tinted", Which::TabsSegmented),
    ("kit-tabs-with-counts", Which::TabsCounts),
    ("kit-tabs-overflow", Which::TabsOverflow),
    ("kit-tabs-last-tab-selected", Which::TabsLastSelected),
    ("kit-switch-states", Which::SwitchStates),
    ("kit-switch-states-light", Which::SwitchStates),
    ("kit-switch-states-tinted", Which::SwitchStates),
    ("kit-switch-focused", Which::SwitchFocused),
    ("kit-switch-long-label", Which::SwitchLongLabel),
    ("kit-checkbox-states", Which::CheckboxStates),
    ("kit-checkbox-states-light", Which::CheckboxStates),
    ("kit-checkbox-states-tinted", Which::CheckboxStates),
    ("kit-checkbox-focused", Which::CheckboxFocused),
    ("kit-checkbox-long-label", Which::CheckboxLongLabel),
    ("kit-radio-group-states", Which::RadioStates),
    ("kit-radio-group-states-light", Which::RadioStates),
    ("kit-radio-group-focused", Which::RadioFocused),
    ("kit-radio-group-long-label", Which::RadioLongLabel),
    ("kit-slider-states", Which::SliderStates),
    ("kit-slider-states-light", Which::SliderStates),
    ("kit-slider-formatted", Which::SliderFormatted),
    ("kit-slider-long-label", Which::SliderLongLabel),
    ("kit-text-field-states", Which::TextFieldStates),
    ("kit-text-field-states-light", Which::TextFieldStates),
    ("kit-text-field-shapes", Which::TextFieldShapes),
    ("kit-text-field-narrow", Which::TextFieldNarrow),
    ("kit-select-field-states", Which::SelectStates),
    ("kit-select-field-focused", Which::SelectFocused),
    ("kit-select-field-states-light", Which::SelectStates),
    ("kit-select-field-focused-light", Which::SelectFocused),
    ("kit-select-field-long-options", Which::SelectLongOptions),
    ("kit-text-field-states-tinted", Which::TextFieldStates),
    ("kit-radio-group-states-tinted", Which::RadioStates),
];

fn build(name: &'static str, window: &mut Window, cx: &mut App) -> AnyView {
    let which = STORIES
        .iter()
        .find(|(story, _)| *story == name)
        .map(|(_, which)| *which)
        .expect("a listed story");
    crate::theme::apply(theme(name), cx);
    cx.new(|cx| Controls::new(which, window, cx)).into()
}

macro_rules! story {
    ($name:literal) => {
        Story::new($name, |_, window, cx| build($name, window, cx))
    };
}

pub fn stories() -> Vec<Story> {
    let all = vec![
        story!("kit-button-variants"),
        story!("kit-button-variants-light"),
        story!("kit-button-variants-tinted"),
        story!("kit-button-states"),
        story!("kit-button-states-light"),
        story!("kit-button-long-label"),
        story!("kit-button-focused"),
        story!("kit-button-focused-ghost"),
        story!("kit-button-focused-danger"),
        story!("kit-button-focused-light"),
        story!("kit-icon-button-variants"),
        story!("kit-icon-button-variants-light"),
        story!("kit-icon-button-variants-tinted"),
        story!("kit-icon-button-states"),
        story!("kit-icon-button-states-light"),
        story!("kit-icon-button-focused"),
        story!("kit-key-cap-keys"),
        story!("kit-key-cap-keys-light"),
        story!("kit-tabs-underline"),
        story!("kit-tabs-underline-light"),
        story!("kit-tabs-segmented"),
        story!("kit-tabs-segmented-light"),
        story!("kit-tabs-segmented-tinted"),
        story!("kit-tabs-with-counts"),
        story!("kit-tabs-overflow"),
        story!("kit-tabs-last-tab-selected"),
        story!("kit-switch-states"),
        story!("kit-switch-states-light"),
        story!("kit-switch-states-tinted"),
        story!("kit-switch-focused"),
        story!("kit-switch-long-label"),
        story!("kit-checkbox-states"),
        story!("kit-checkbox-states-light"),
        story!("kit-checkbox-states-tinted"),
        story!("kit-checkbox-focused"),
        story!("kit-checkbox-long-label"),
        story!("kit-radio-group-states"),
        story!("kit-radio-group-states-light"),
        story!("kit-radio-group-states-tinted"),
        story!("kit-radio-group-focused"),
        story!("kit-radio-group-long-label"),
        story!("kit-slider-states"),
        story!("kit-slider-states-light"),
        story!("kit-slider-formatted"),
        story!("kit-slider-long-label"),
        story!("kit-text-field-states"),
        story!("kit-text-field-states-light"),
        story!("kit-text-field-states-tinted"),
        story!("kit-text-field-shapes"),
        story!("kit-text-field-narrow"),
        story!("kit-select-field-states"),
        story!("kit-select-field-states-light"),
        story!("kit-select-field-focused"),
        story!("kit-select-field-focused-light"),
        story!("kit-select-field-long-options"),
    ];
    debug_assert_eq!(all.len(), STORIES.len());
    all
}
