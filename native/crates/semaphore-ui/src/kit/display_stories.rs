//! The display components' stories, one for each of the web kit's (`frontend/src/stories/kit/`),
//! under the same ids: `kit-avatar--sizes` is `KitAvatar.stories.tsx`'s `Sizes`. Each applies its
//! own theme, as the web's `KitStage` does: dark, light, or tinted (teal, vibrant).

use super::display::rgb_token;
use super::{
    Alert, Avatar, AvatarShape, AvatarSize, AvatarStack, Badge, BadgeTone, ControlHeight,
    IconButton, IconSize, LinearProgress, Pill, PillSize, PillTone, Presence, ProgressTone,
    Severity, Skeleton, Spinner, StackPerson, Toast, ToastTone,
};
use crate::stories::Story;
use crate::theme::{self, FONT_FAMILY, SemTheme, ThemeInput};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::colour_params::PEOPLE;
use semaphore_design::lounge::{LAYOUT_GUTTER, SPACE_MD, SPACE_SM, SPACE_XL, TEXT_SMALL};
use semaphore_design::{Icon as IconName, Intensity, LoungeIcon, Mode, Rgba as Token};
use std::sync::Arc;

#[derive(Clone, Copy)]
enum Look {
    Dark,
    Light,
    Tinted,
}

impl Look {
    fn input(self) -> ThemeInput {
        match self {
            Look::Dark => ThemeInput::new(theme::DEFAULT_BASE, Mode::Dark, Intensity::Minimal),
            Look::Light => ThemeInput::new(theme::DEFAULT_BASE, Mode::Light, Intensity::Minimal),
            Look::Tinted => ThemeInput::new(rgb_token(0x0d9488), Mode::Dark, Intensity::Vibrant),
        }
    }
}

type Body = fn(&App) -> Vec<AnyElement>;

/// The page a story renders on: the ground, the gutter, and the rows a `space.xl` apart.
struct Stage {
    body: Body,
}

impl Render for Stage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .id("kit-stage")
            .size_full()
            .overflow_y_scroll()
            .bg(sem.role.ground)
            .text_color(sem.role.text)
            .font_family(FONT_FAMILY)
            .p(px(LAYOUT_GUTTER))
            .flex()
            .flex_col()
            .gap(px(SPACE_XL))
            .children((self.body)(cx))
    }
}

/// A story on its own theme. A macro, so the closure captures nothing and is a plain `fn`.
macro_rules! story {
    ($name:literal, $look:expr, $body:expr $(,)?) => {
        Story::new($name, |_, _, cx| {
            theme::apply($look.input(), cx);
            cx.new(|_| Stage { body: $body }).into()
        })
    };
}

/// A labelled row, as the web stories' `Row`.
fn row(label: impl Into<SharedString>, cx: &App, children: Vec<AnyElement>) -> AnyElement {
    let sem = cx.sem();
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_SM))
        .child(
            div()
                .text_size(px(TEXT_SMALL.size))
                .line_height(px(TEXT_SMALL.line_height))
                .text_color(sem.role.text_secondary)
                .child(label.into()),
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(SPACE_MD))
                .children(children),
        )
        .into_any_element()
}

/// A column of pieces a `space.md` apart, `width` wide (or the row's width).
fn column(width: Option<f32>, children: Vec<AnyElement>) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_MD))
        .map(|column| match width {
            Some(width) => column.w(px(width)).max_w_full(),
            None => column.w_full(),
        })
        .children(children)
        .into_any_element()
}

fn any(element: impl IntoElement) -> AnyElement {
    element.into_any_element()
}

// Avatar -----------------------------------------------------------------------------------------

/// People from the design sheet: name and their own colour.
const PEOPLE_SHEET: [(&str, u32); 6] = [
    ("aiko", 0xFF8FB8),
    ("dropbear", 0x5FD49A),
    ("gracie", 0xFFA366),
    ("kwam3", 0x6FB1F5),
    ("pri", 0xC792F0),
    ("Samira", 0x5ED1D1),
];

fn person(index: usize) -> Avatar {
    let (name, colour) = PEOPLE_SHEET[index];
    Avatar::new(name)
        .id(SharedString::from(format!("p-{index}-{name}")))
        .colour(rgb_token(colour))
}

fn sheet(people: usize) -> Vec<StackPerson> {
    PEOPLE_SHEET[..people]
        .iter()
        .map(|(name, colour)| StackPerson::new(*name).colour(rgb_token(*colour)))
        .collect()
}

fn sizes_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "xs, sm, md, lg, xl: a colour each",
            cx,
            AvatarSize::ALL
                .into_iter()
                .enumerate()
                .map(|(index, size)| any(person(index).id(format!("s-{index}")).size(size)))
                .collect(),
        ),
        row(
            "md: six people colours",
            cx,
            (0..6).map(|index| any(person(index))).collect(),
        ),
        row(
            "No colour: fill and secondary initials",
            cx,
            AvatarSize::ALL
                .into_iter()
                .map(|size| any(Avatar::new("Alex Kim").id(size.name()).size(size)))
                .collect(),
        ),
    ]
}

fn sizes_light_body(cx: &App) -> Vec<AnyElement> {
    let mut rows = sizes_body(cx);
    rows.push(row(
        "Stack",
        cx,
        vec![any(AvatarStack::new("stack", sheet(6)))],
    ));
    rows
}

fn presence_body(cx: &App) -> Vec<AnyElement> {
    [AvatarSize::Md, AvatarSize::Lg]
        .into_iter()
        .map(|size| {
            row(
                size.name(),
                cx,
                Presence::ALL
                    .into_iter()
                    .enumerate()
                    .map(|(index, presence)| {
                        any(person(index)
                            .id(format!("{}-{index}", size.name()))
                            .size(size)
                            .presence(presence))
                    })
                    .collect(),
            )
        })
        .collect()
}

fn presence_tinted_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "md",
            cx,
            Presence::ALL
                .into_iter()
                .enumerate()
                .map(|(index, presence)| any(person(index).presence(presence)))
                .collect(),
        ),
        row(
            "Stack and no colour",
            cx,
            vec![
                any(AvatarStack::new("stack", sheet(6))),
                any(Avatar::new("Alex Kim")),
            ],
        ),
    ]
}

fn communities_body(cx: &App) -> Vec<AnyElement> {
    let community = |colour: Option<Token>| {
        AvatarSize::ALL
            .into_iter()
            .map(|size| {
                any(Avatar::new("Couch Co-op")
                    .id(format!("c-{}-{}", size.name(), colour.is_some()))
                    .size(size)
                    .shape(AvatarShape::Rounded)
                    .colour(colour))
            })
            .collect()
    };
    vec![
        row(
            "Couch Co-op, rounded",
            cx,
            community(Some(rgb_token(0xFF9A6B))),
        ),
        row("No colour", cx, community(None)),
    ]
}

fn fallbacks_body(cx: &App) -> Vec<AnyElement> {
    let missing = || ImageSource::from(std::path::PathBuf::from("/this-image-does-not-exist.png"));
    let named = |id: &str, name: &str, colour: Option<u32>| {
        Avatar::new(name.to_owned())
            .id(SharedString::from(id.to_owned()))
            .colour(colour.map(rgb_token))
    };
    vec![
        row(
            "Broken image (initials show)",
            cx,
            vec![
                any(named("b1", "aiko", Some(0xFF8FB8)).src(missing())),
                any(named("b2", "Couch Co-op", Some(0xFF9A6B))
                    .shape(AvatarShape::Rounded)
                    .size(AvatarSize::Xl)
                    .src(missing())),
            ],
        ),
        row(
            "Empty name (icon)",
            cx,
            vec![
                any(named("e1", "", None)),
                any(named("e2", "", Some(0x6FB1F5)).size(AvatarSize::Lg)),
            ],
        ),
        row(
            "One word, many words, long",
            cx,
            vec![
                any(named("w1", "dropbear", Some(0x5FD49A))),
                any(named("w2", "Mary Jane Watson-Parker", Some(0xC792F0))),
                any(named(
                    "w3",
                    "Pneumonoultramicroscopicsilicovolcanoconiosis",
                    Some(0xFFA366),
                )),
            ],
        ),
        row(
            "Emoji and non-Latin",
            cx,
            vec![
                any(named("n1", "🎉", Some(0xFF8FB8))),
                any(named("n2", "Ünal çelik", Some(0x5ED1D1))),
                any(named("n3", "日本語の名前", Some(0x6FB1F5))),
            ],
        ),
    ]
}

/// A small logo on a transparent background: a white ring and a dot, no fill.
fn transparent_logo() -> ImageSource {
    use gpui_kit::RenderImage;
    use image::{Frame, RgbaImage};
    const SIDE: u32 = 128;
    let buffer = RgbaImage::from_fn(SIDE, SIDE, |x, y| {
        let centre = SIDE as f32 / 2.;
        let distance =
            ((x as f32 + 0.5 - centre).powi(2) + (y as f32 + 0.5 - centre).powi(2)).sqrt() * 40.
                / SIDE as f32;
        let ink = (11. ..=15.).contains(&distance) || distance <= 4.;
        image::Rgba([255, 255, 255, if ink { 255 } else { 0 }])
    });
    ImageSource::Render(Arc::new(RenderImage::new(vec![Frame::new(buffer)])))
}

fn transparent_body(cx: &App) -> Vec<AnyElement> {
    vec![row(
        "On the community colour, then on no colour",
        cx,
        vec![
            any(Avatar::new("Couch Co-op")
                .id("t1")
                .shape(AvatarShape::Rounded)
                .colour(rgb_token(0xFF9A6B))
                .src(transparent_logo())
                .size(AvatarSize::Xl)),
            any(Avatar::new("Couch Co-op")
                .id("t2")
                .shape(AvatarShape::Rounded)
                .src(transparent_logo())
                .size(AvatarSize::Xl)),
            any(Avatar::new("Couch Co-op")
                .id("t3")
                .colour(rgb_token(0x6FB1F5))
                .src(transparent_logo())),
        ],
    )]
}

fn stack_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "Six people, max 3 (default)",
            cx,
            vec![any(AvatarStack::new("s6", sheet(6)))],
        ),
        row(
            "Two people",
            cx,
            vec![any(AvatarStack::new("s2", sheet(2)))],
        ),
        row(
            "max 4 at md, max 2 at lg",
            cx,
            vec![
                any(AvatarStack::new("s4", sheet(6)).max(4).size(AvatarSize::Md)),
                any(AvatarStack::new("s2lg", sheet(6))
                    .max(2)
                    .size(AvatarSize::Lg)),
            ],
        ),
    ]
}

fn crew() -> Vec<StackPerson> {
    vec![
        StackPerson::new("dropbear")
            .colour(rgb_token(0x5FD49A))
            .speaking(true),
        StackPerson::new("pri").colour(rgb_token(0xC792F0)),
        StackPerson::new("aiko").colour(rgb_token(0xFF8FB8)),
        StackPerson::new("kwam3")
            .colour(rgb_token(0x6FB1F5))
            .speaking(true),
    ]
}

fn speaking_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "dropbear is talking",
            cx,
            vec![any(AvatarStack::new("crew3", crew()[..3].to_vec()))],
        ),
        row(
            "Two talking, one behind the +N (max 3)",
            cx,
            vec![any(AvatarStack::new("crew4", crew()))],
        ),
        row(
            "The four, max 4, at xs, sm, md, lg and xl",
            cx,
            AvatarSize::ALL
                .into_iter()
                .map(|size| any(AvatarStack::new(size.name(), crew()).max(4).size(size)))
                .collect(),
        ),
    ]
}

/// Two-letter names, one per colour, so each face has initials.
const NINE: [&str; 9] = [
    "Pi Nk", "Or An", "Ye Lo", "Li Me", "Gr Ee", "Te Al", "Bl Ue", "In Di", "Pu Rp",
];

fn people_colours_body(cx: &App) -> Vec<AnyElement> {
    let face = |index: usize, key: &str| {
        Avatar::new(NINE[index])
            .id(SharedString::from(format!("{key}-{index}")))
            .colour(rgb_token(PEOPLE[index]))
    };
    let mut rows: Vec<AnyElement> = [AvatarSize::Md, AvatarSize::Lg]
        .into_iter()
        .map(|size| {
            row(
                format!("{}: the nine colours, in list order", size.name()),
                cx,
                (0..9)
                    .map(|index| any(face(index, size.name()).size(size)))
                    .collect(),
            )
        })
        .collect();
    rows.extend(Presence::ALL.into_iter().map(|presence| {
        row(
            presence.name(),
            cx,
            (0..9)
                .map(|index| any(face(index, presence.name()).presence(presence)))
                .collect(),
        )
    }));
    let talking = [3, 4, 5, 6]
        .into_iter()
        .map(|index| {
            StackPerson::new(NINE[index])
                .colour(rgb_token(PEOPLE[index]))
                .speaking(index != 6)
        })
        .collect();
    let everyone = (0..9)
        .map(|index| StackPerson::new(NINE[index]).colour(rgb_token(PEOPLE[index])))
        .collect();
    rows.push(row(
        "Stacks: green, lime and teal talking",
        cx,
        vec![
            any(AvatarStack::new("talking", talking).max(4)),
            any(AvatarStack::new("everyone", everyone)),
        ],
    ));
    rows
}

// Badge, Pill, Spinner ---------------------------------------------------------------------------

fn badge_body(cx: &App) -> Vec<AnyElement> {
    let mut rows: Vec<AnyElement> = [BadgeTone::Accent, BadgeTone::Danger]
        .into_iter()
        .map(|tone| {
            let name = if tone == BadgeTone::Accent {
                "accent"
            } else {
                "danger"
            };
            let mut badges: Vec<AnyElement> = [1, 9, 42, 99, 100]
                .into_iter()
                .map(|count| {
                    any(Badge::new(format!("{count} unread"))
                        .count(count)
                        .tone(tone))
                })
                .collect();
            badges.push(any(Badge::new("New activity").dot(true).tone(tone)));
            row(name, cx, badges)
        })
        .collect();
    rows.push(row(
        "On an icon button (wrapper positions the badge)",
        cx,
        vec![any(Badge::new("7 unread")
            .count(7)
            .tone(BadgeTone::Accent)
            .on(IconButton::new(
                "bell",
                IconName::NotificationsNone,
                "Notifications",
            )))],
    ));
    rows
}

fn pill_body(cx: &App) -> Vec<AnyElement> {
    let mut rows = Vec::new();
    for size in [PillSize::Md, PillSize::Sm] {
        let name = if size == PillSize::Md { "md" } else { "sm" };
        let tones = |make: fn(Pill) -> Pill| {
            PillTone::ALL
                .into_iter()
                .map(|tone| any(make(Pill::new(tone.name()).tone(tone).size(size))))
                .collect()
        };
        rows.push(row(format!("{name}: plain"), cx, tones(|pill| pill)));
        rows.push(row(
            format!("{name}: with dot"),
            cx,
            tones(|pill| pill.dot(true)),
        ));
        rows.push(row(
            format!("{name}: with icon"),
            cx,
            tones(|pill| pill.icon(LoungeIcon::Bell)),
        ));
    }
    rows.push(row(
        "Long text stays on one line",
        cx,
        vec![any(Pill::new("Reconnecting to the voice server…")
            .dot(true)
            .tone(PillTone::Warning))],
    ));
    rows
}

fn spinner_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "Decorative",
            cx,
            IconSize::ALL
                .into_iter()
                .map(|size| any(Spinner::new(size.name()).size(size)))
                .collect(),
        ),
        row(
            "With a label (role status)",
            cx,
            IconSize::ALL
                .into_iter()
                .map(|size| {
                    any(
                        Spinner::new(SharedString::from(format!("l-{}", size.name())))
                            .size(size)
                            .label(format!("Loading {}", size.name())),
                    )
                })
                .collect(),
        ),
    ]
}

// Progress and loading ---------------------------------------------------------------------------

fn progress_body(cx: &App) -> Vec<AnyElement> {
    ProgressTone::ALL
        .into_iter()
        .map(|tone| {
            let mut bars: Vec<AnyElement> = [0., 40., 100.]
                .into_iter()
                .map(|value| {
                    let label = format!("{} {value}", tone.name());
                    any(
                        LinearProgress::new(SharedString::from(label.clone()), Some(value), label)
                            .tone(tone),
                    )
                })
                .collect();
            let label = format!("{} indeterminate", tone.name());
            bars.push(any(LinearProgress::new(
                SharedString::from(label.clone()),
                None,
                label,
            )
            .tone(tone)));
            row(tone.name(), cx, vec![column(None, bars)])
        })
        .collect()
}

fn skeleton_body(cx: &App) -> Vec<AnyElement> {
    vec![
        row(
            "A list row: circle and two text lines",
            cx,
            vec![any(div()
                .w_full()
                .flex()
                .items_center()
                .gap(px(SPACE_MD))
                .child(Skeleton::circle("row-circle", AvatarSize::Lg))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(Skeleton::text("row-text", 2)),
                ))],
        ),
        row(
            "Circle sizes",
            cx,
            [AvatarSize::Xs, AvatarSize::Md, AvatarSize::Xl]
                .into_iter()
                .map(|size| any(Skeleton::circle(size.name(), size)))
                .collect(),
        ),
        row(
            "Rect",
            cx,
            vec![any(div()
                .w_full()
                .child(Skeleton::rect("rect", ControlHeight::default())))],
        ),
        row(
            "Text, three lines",
            cx,
            vec![any(div().w_full().child(Skeleton::text("three", 3)))],
        ),
    ]
}

// Alert and Toast --------------------------------------------------------------------------------

const BODY: &str = "Something worth knowing happened in this community.";

fn severities_body(cx: &App) -> Vec<AnyElement> {
    let alerts = |titled: bool| {
        Severity::ALL
            .into_iter()
            .map(|severity| {
                let alert = Alert::new(severity, BODY)
                    .id(SharedString::from(format!("{}-{titled}", severity.name())));
                any(if titled {
                    alert.title(format!("A {} title", severity.name()))
                } else {
                    alert
                })
            })
            .collect()
    };
    vec![
        row("Title and body", cx, vec![column(None, alerts(true))]),
        row("Body only", cx, vec![column(None, alerts(false))]),
    ]
}

fn with_actions_body(_: &App) -> Vec<AnyElement> {
    vec![column(
        None,
        vec![
            any(
                Alert::new(Severity::Warning, "We could not reach the voice server.")
                    .id("lost")
                    .title("Connection lost")
                    .action("Reconnect", |_, _| {}),
            ),
            any(Alert::new(Severity::Info, "A new version is available.")
                .id("update")
                .on_close(|_, _| {})),
            any(Alert::new(
                Severity::Danger,
                "The file is larger than the community allows.",
            )
            .id("upload")
            .title("Upload failed")
            .action("Try again", |_, _| {})
            .on_close(|_, _| {})),
        ],
    )]
}

fn long_text_body(_: &App) -> Vec<AnyElement> {
    vec![column(
        Some(320.),
        vec![any(Alert::new(
            Severity::Danger,
            "This message keeps going so that it wraps, with an unbroken token \
             https://example.com/a/very/long/path/that/never/ends/and/never/breaks/at/all",
        )
        .title("A rather long title that has to wrap onto a second line")
        .action("Try again", |_, _| {})
        .on_close(|_, _| {}))],
    )]
}

fn call_alerts() -> Vec<AnyElement> {
    vec![
        any(
            Alert::new(Severity::Info, "dropbear is calling you in Squad Up.")
                .id("call")
                .title("Incoming call")
                .action("Join", |_, _| {})
                .secondary_action("Decline", |_, _| {}),
        ),
        any(Alert::new(Severity::Warning, "A new version is ready.")
            .id("ready")
            .secondary_action("Not now", |_, _| {})
            .on_close(|_, _| {})),
        any(Alert::new(Severity::Danger, "We could not reach Hangout.")
            .id("hangout")
            .action("Retry", |_, _| {})
            .secondary_action("Dismiss for today", |_, _| {})),
    ]
}

fn secondary_body(_: &App) -> Vec<AnyElement> {
    vec![column(None, call_alerts())]
}

fn secondary_long_body(_: &App) -> Vec<AnyElement> {
    vec![column(
        Some(260.),
        vec![any(Alert::new(Severity::Info, "dropbear is calling you.")
            .title("Incoming call")
            .action("Join the call in Squad Up", |_, _| {})
            .secondary_action(
                "Decline and let dropbear know",
                |_, _| {},
            ))],
    )]
}

fn secondary_one_long_body(_: &App) -> Vec<AnyElement> {
    vec![column(
        Some(220.),
        vec![any(Alert::new(
            Severity::Warning,
            "dropbear is calling you.",
        )
        .action(
            "Join the call in Squad Up with dropbear and pri",
            |_, _| {},
        ))],
    )]
}

fn toast_column(children: Vec<AnyElement>) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .items_start()
        .gap(px(SPACE_MD))
        .children(children)
        .into_any_element()
}

fn toast_body(cx: &App) -> Vec<AnyElement> {
    let toasts = |actions: bool| {
        ToastTone::ALL
            .into_iter()
            .map(|tone| {
                let toast = Toast::new(
                    SharedString::from(format!("{}-{actions}", tone.name())),
                    format!("A {} notice", tone.name()),
                )
                .tone(tone);
                any(if actions {
                    toast.action("Undo", |_, _| {}).on_close(|_, _| {})
                } else {
                    toast
                })
            })
            .collect()
    };
    vec![
        row("Message only", cx, vec![toast_column(toasts(false))]),
        row("Action and close", cx, vec![toast_column(toasts(true))]),
    ]
}

fn toast_long_body(_: &App) -> Vec<AnyElement> {
    vec![
        div()
            .w(px(320.))
            .max_w_full()
            .child(
                Toast::new(
                    "long",
                    "Could not send your message to the channel because the connection dropped: \
                 https://example.com/a/very/long/path/that/never/ends",
                )
                .tone(ToastTone::Danger)
                .action("Retry", |_, _| {})
                .on_close(|_, _| {}),
            )
            .into_any_element(),
    ]
}

pub fn stories() -> Vec<Story> {
    use Look::{Dark, Light, Tinted};
    vec![
        story!("kit-avatar--sizes", Dark, sizes_body),
        story!("kit-avatar--sizes-light", Light, sizes_light_body),
        story!("kit-avatar--presence", Dark, presence_body),
        story!("kit-avatar--presence-tinted", Tinted, presence_tinted_body),
        story!("kit-avatar--communities", Dark, communities_body),
        story!("kit-avatar--fallbacks", Dark, fallbacks_body),
        story!("kit-avatar--transparent-image", Dark, transparent_body),
        story!("kit-avatar--stack", Dark, stack_body),
        story!("kit-avatar--stack-speaking", Dark, speaking_body),
        story!("kit-avatar--stack-speaking-light", Light, speaking_body),
        story!("kit-avatar--stack-speaking-tinted", Tinted, speaking_body),
        story!("kit-avatar--people-colours", Dark, people_colours_body),
        story!(
            "kit-avatar--people-colours-light",
            Light,
            people_colours_body
        ),
        story!(
            "kit-avatar--people-colours-tinted",
            Tinted,
            people_colours_body
        ),
        story!("kit-badge--counts", Dark, badge_body),
        story!("kit-badge--counts-light", Light, badge_body),
        story!("kit-badge--counts-tinted", Tinted, badge_body),
        story!("kit-pill--tones", Dark, pill_body),
        story!("kit-pill--tones-light", Light, pill_body),
        story!("kit-pill--tones-tinted", Tinted, pill_body),
        story!("kit-spinner--sizes", Dark, spinner_body),
        story!("kit-spinner--sizes-light", Light, spinner_body),
        story!("kit-linear-progress--values", Dark, progress_body),
        story!("kit-linear-progress--values-light", Light, progress_body),
        story!("kit-linear-progress--values-tinted", Tinted, progress_body),
        story!("kit-skeleton--shapes", Dark, skeleton_body),
        story!("kit-skeleton--shapes-light", Light, skeleton_body),
        story!("kit-alert--severities", Dark, severities_body),
        story!("kit-alert--severities-light", Light, severities_body),
        story!("kit-alert--severities-tinted", Tinted, severities_body),
        story!("kit-alert--with-actions", Dark, with_actions_body),
        story!("kit-alert--with-actions-light", Light, with_actions_body),
        story!("kit-alert--long-text", Dark, long_text_body),
        story!("kit-alert--secondary-action", Dark, secondary_body),
        story!("kit-alert--secondary-action-light", Light, secondary_body),
        story!(
            "kit-alert--secondary-action-long",
            Dark,
            secondary_long_body
        ),
        story!(
            "kit-alert--secondary-action-one-long",
            Dark,
            secondary_one_long_body,
        ),
        story!("kit-toast--tones", Dark, toast_body),
        story!("kit-toast--tones-light", Light, toast_body),
        story!("kit-toast--tones-tinted", Tinted, toast_body),
        story!("kit-toast--long-message", Dark, toast_long_body),
    ]
}
