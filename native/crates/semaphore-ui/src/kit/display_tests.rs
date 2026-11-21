//! The display components: initials, names, counts and roles as the web kit defines them, the
//! readable-ink contrast on every person colour, and what a drawn component exposes.

use super::display::{
    avatar_label, badge_text, clamp_percent, initials_of, live_role, readable_face, rgb_token,
    stack_label,
};
use super::{
    Alert, Avatar, AvatarSize, AvatarStack, Badge, CountMeaning, LinearProgress, Presence,
    Severity, Spinner, StackPerson, Toast, ToastTone, count_words,
};
use crate::dms::rig::{Rig, rig};
use crate::theme::color::token_of;
use crate::theme::{Sem, ThemeInput};
use core::prelude::v1::test;
use gpui_kit::test::TestQueryExt as _;
use gpui_kit::*;
use semaphore_design::colour_params::PEOPLE;
use semaphore_design::derive::contrast_ratio;
use semaphore_design::{Intensity, Mode, person_colour};
use std::cell::RefCell;

#[test]
fn initials_follow_the_web_rule() {
    for (name, expected) in [
        ("Alex Kim", "AK"),
        ("dropbear", "DR"),
        ("Mary Jane Watson-Parker", "MJ"),
        ("(mike)", "MI"),
        ("  pri  ", "PR"),
        ("🎉", "🎉"),
        ("Ünal çelik", "ÜÇ"),
        ("日本語の名前", "日本"),
        ("ßeta", "ßE"),
        ("- ana", "AN"),
        ("", ""),
        ("   ", ""),
        ("?!", ""),
    ] {
        assert_eq!(initials_of(name), expected, "{name:?}");
    }
}

#[test]
fn an_avatar_is_named_with_its_presence_and_never_blank() {
    assert_eq!(
        avatar_label("Ana Ruiz", Some(Presence::Away)),
        "Ana Ruiz, away"
    );
    assert_eq!(
        avatar_label("aiko", Some(Presence::Speaking)),
        "aiko, speaking"
    );
    assert_eq!(avatar_label("aiko", None), "aiko");
    assert_eq!(
        avatar_label(" ", Some(Presence::Online)),
        "Unknown user, online"
    );
}

fn people(names: &[&str]) -> Vec<StackPerson> {
    names.iter().map(|name| StackPerson::new(*name)).collect()
}

#[test]
fn a_stack_names_the_shown_people_and_the_rest() {
    assert_eq!(stack_label(&people(&["Ana"]), 3), "Ana");
    assert_eq!(stack_label(&people(&["Ana", "Ben"]), 3), "Ana and Ben");
    assert_eq!(
        stack_label(&people(&["Ana", "Ben", "Cy"]), 3),
        "Ana, Ben and Cy"
    );
    assert_eq!(
        stack_label(&people(&["Ana", "Ben", "Cy", "Di", "Ed"]), 3),
        "Ana, Ben, Cy and 2 more"
    );
    assert_eq!(stack_label(&people(&["Ana", "Ben"]), 0), "2 people");
    assert_eq!(
        stack_label(&people(&["", "Ben"]), 3),
        "Unknown user and Ben"
    );
    // A comma in a name is not where "and" goes.
    assert_eq!(
        stack_label(&people(&["Kim, A", "Ben"]), 3),
        "Kim, A and Ben"
    );
}

#[test]
fn a_stack_says_who_is_talking_also_behind_the_more() {
    let mut crew = people(&["pri", "dropbear", "aiko"]);
    crew[1].speaking = true;
    assert_eq!(
        stack_label(&crew, 3),
        "pri, dropbear and aiko, dropbear is talking"
    );
    crew[0].speaking = true;
    assert_eq!(
        stack_label(&crew, 3),
        "pri, dropbear and aiko, pri and dropbear are talking"
    );
    let mut four = people(&["a", "b", "c", "d"]);
    four[3].speaking = true;
    assert_eq!(stack_label(&four, 3), "a, b, c and 1 more, d is talking");
    // More than three speakers: two by name and "N more".
    let mut five = people(&["a", "b", "c", "d", "e"]);
    for person in &mut five {
        person.speaking = true;
    }
    assert_eq!(
        stack_label(&five, 5),
        "a, b, c, d and e, a, b and 3 more are talking"
    );
    let mut three = people(&["a", "b", "c"]);
    for person in &mut three {
        person.speaking = true;
    }
    assert_eq!(stack_label(&three, 3), "a, b and c, a, b and c are talking");
}

#[test]
fn a_badge_shows_nothing_below_one_and_caps_at_max() {
    assert_eq!(badge_text(0, 99), None);
    assert_eq!(badge_text(1, 99).as_deref(), Some("1"));
    assert_eq!(badge_text(99, 99).as_deref(), Some("99"));
    assert_eq!(badge_text(100, 99).as_deref(), Some("99+"));
    assert_eq!(badge_text(10, 9).as_deref(), Some("9+"));
    // A max below 1 means 99.
    assert_eq!(badge_text(150, 0).as_deref(), Some("99+"));
    assert_eq!(count_words(3, CountMeaning::Unread), "3 unread");
    assert_eq!(count_words(1, CountMeaning::Mentions), "1 mention");
    assert_eq!(count_words(3, CountMeaning::Mentions), "3 mentions");
}

#[test]
fn progress_is_held_to_0_to_100() {
    assert_eq!(clamp_percent(-5.), 0.);
    assert_eq!(clamp_percent(40.), 40.);
    assert_eq!(clamp_percent(250.), 100.);
    assert_eq!(clamp_percent(f32::NAN), 0.);
}

#[test]
fn urgent_notices_interrupt_and_quiet_ones_are_notes() {
    assert_eq!(live_role(true, true), Role::Alert);
    assert_eq!(live_role(false, true), Role::Status);
    assert_eq!(live_role(true, false), Role::Note);
    assert_eq!(live_role(false, false), Role::Note);
}

/// Every person colour, in each look the stories use, reads at 4.5:1 with the ink it is given;
/// the same for the nudged colours of a sweep.
#[test]
fn initials_reach_4_5_on_every_person_colour_in_every_look() {
    let looks = [
        ThemeInput::new(crate::theme::DEFAULT_BASE, Mode::Dark, Intensity::Minimal),
        ThemeInput::new(crate::theme::DEFAULT_BASE, Mode::Light, Intensity::Minimal),
        ThemeInput::new(rgb_token(0x0d9488), Mode::Dark, Intensity::Vibrant),
        ThemeInput::new(rgb_token(0x0d9488), Mode::Light, Intensity::Vibrant),
    ];
    let sweep = [
        0x000000, 0x777777, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0x808000,
    ];
    for input in looks {
        let sem = Sem::new(input);
        for colour in PEOPLE.into_iter().chain(sweep) {
            let (background, ink) =
                readable_face(&sem, rgb_token(colour)).expect("a readable face");
            let ratio = contrast_ratio(token_of(ink), token_of(background));
            assert!(ratio >= 4.5, "{colour:06x} in {}: {ratio}", input.name());
            assert!(
                [sem.role.ground, sem.role.text].contains(&ink),
                "the ink is the page or the text colour"
            );
        }
    }
}

#[test]
fn a_persons_colour_comes_from_their_id() {
    // From design/vectors/person-colour.json: "alexk" is index 1.
    assert_eq!(person_colour(Some("alexk")), Some(rgb_token(PEOPLE[1])));
}

/// A view drawing whatever `build` makes, to look at the accessibility tree.
struct Host {
    build: fn() -> AnyElement,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child((self.build)())
    }
}

fn host(cx: &mut TestAppContext, build: fn() -> AnyElement) -> Rig<Host, ()> {
    rig(cx, 800., move |_, _| Host { build })
}

fn labels(rig: &Rig<Host, ()>, cx: &mut TestAppContext, role: Role) -> Vec<String> {
    rig.with(cx, |_, window, _| {
        window
            .find_all_by_role(role)
            .iter()
            .map(|node| node.label().unwrap_or_default().to_owned())
            .collect()
    })
}

#[gpui_kit::test]
fn an_avatar_is_an_image_named_by_its_person_unless_decorative(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .child(Avatar::new("Ana Ruiz").presence(Presence::Away))
            .child(Avatar::new("").id("blank"))
            .child(Avatar::new("hidden").decorative(true))
            .into_any_element()
    });
    assert_eq!(
        labels(&rig, cx, Role::Image),
        ["Ana Ruiz, away", "Unknown user"]
    );
}

#[gpui_kit::test]
fn an_avatar_is_its_tokens_size(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .flex()
            .child(Avatar::new("xs").size(AvatarSize::Xs))
            .child(Avatar::new("xl").size(AvatarSize::Xl))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        for (label, side) in [("xs", 20.), ("xl", 64.)] {
            let bounds = window.find_by_label(label).bounds();
            assert_eq!(bounds.size, size(px(side), px(side)), "{label}");
        }
    });
}

#[gpui_kit::test]
fn a_stack_is_one_image_with_the_groups_name(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        AvatarStack::new(
            "crew",
            vec![
                StackPerson::new("pri"),
                StackPerson::new("dropbear").speaking(true),
                StackPerson::new("aiko"),
                StackPerson::new("kwam3").speaking(true),
            ],
        )
        .into_any_element()
    });
    assert_eq!(
        labels(&rig, cx, Role::Image),
        ["pri, dropbear, aiko and 1 more, dropbear and kwam3 are talking"]
    );
}

#[gpui_kit::test]
fn an_empty_stack_draws_nothing_and_a_label_replaces_the_name(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .child(AvatarStack::new("empty", Vec::new()))
            .child(AvatarStack::new("named", vec![StackPerson::new("pri")]).label("In the call"))
            .into_any_element()
    });
    assert_eq!(labels(&rig, cx, Role::Image), ["In the call"]);
}

#[gpui_kit::test]
fn a_badge_is_named_by_its_meaning_and_zero_draws_nothing(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .child(Badge::new("3 unread").count(3))
            .child(Badge::new("0 unread").count(0))
            .child(Badge::new("New activity").dot(true))
            .into_any_element()
    });
    assert_eq!(labels(&rig, cx, Role::Image), ["3 unread", "New activity"]);
}

#[gpui_kit::test]
fn a_spinner_is_a_status_only_with_a_label(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .child(Spinner::new("quiet"))
            .child(Spinner::new("named").label("Loading members"))
            .into_any_element()
    });
    assert_eq!(labels(&rig, cx, Role::Status), ["Loading members"]);
}

#[gpui_kit::test]
fn a_progress_bar_is_named(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .w(px(200.))
            .child(LinearProgress::new("up", Some(140.), "Uploading"))
            .child(LinearProgress::new("wait", None, "Waiting"))
            .into_any_element()
    });
    assert_eq!(
        labels(&rig, cx, Role::ProgressIndicator),
        ["Uploading", "Waiting"]
    );
}

#[gpui_kit::test]
fn an_alerts_role_follows_its_severity_and_announce(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .child(Alert::new(Severity::Danger, "Upload failed").id("a1"))
            .child(Alert::new(Severity::Warning, "Slow").id("a2"))
            .child(Alert::new(Severity::Info, "Saved").id("a3").title("Note"))
            .child(Alert::new(Severity::Success, "Done").id("a4"))
            .child(
                Alert::new(Severity::Danger, "Already here")
                    .id("a5")
                    .announce(false),
            )
            .into_any_element()
    });
    assert_eq!(labels(&rig, cx, Role::Alert), ["Upload failed", "Slow"]);
    assert_eq!(labels(&rig, cx, Role::Status), ["Note. Saved", "Done"]);
    assert_eq!(labels(&rig, cx, Role::Note), ["Already here"]);
}

thread_local! {
    static PRESSED: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
}

fn press(name: &'static str) -> impl Fn(&mut Window, &mut App) + 'static {
    move |_, _| PRESSED.with(|pressed| pressed.borrow_mut().push(name))
}

#[gpui_kit::test]
fn an_alerts_actions_and_dismiss_each_run_their_own(cx: &mut TestAppContext) {
    PRESSED.with(|pressed| pressed.borrow_mut().clear());
    let rig = host(cx, || {
        Alert::new(Severity::Info, "dropbear is calling you.")
            .id("call")
            .title("Incoming call")
            .action("Join", press("join"))
            .secondary_action("Decline", press("decline"))
            .on_close(press("close"))
            .into_any_element()
    });
    assert!(rig.has(cx, "call-action"));
    rig.click(cx, "call-secondary-action");
    rig.click(cx, "call-action");
    rig.click(cx, "call-dismiss");
    assert_eq!(
        PRESSED.with(|pressed| pressed.borrow().clone()),
        ["decline", "join", "close"]
    );
}

#[gpui_kit::test]
fn an_alert_without_actions_has_no_buttons(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        Alert::new(Severity::Info, "Saved")
            .id("plain")
            .into_any_element()
    });
    assert!(!rig.has(cx, "plain-action"));
    assert!(!rig.has(cx, "plain-secondary-action"));
    assert!(!rig.has(cx, "plain-dismiss"));
}

#[gpui_kit::test]
fn a_danger_toast_interrupts_and_the_others_wait(cx: &mut TestAppContext) {
    let rig = host(cx, || {
        div()
            .child(Toast::new("t1", "Could not save").tone(ToastTone::Danger))
            .child(Toast::new("t2", "Saved").tone(ToastTone::Positive))
            .child(Toast::new("t3", "Old news").announce(false))
            .into_any_element()
    });
    assert_eq!(labels(&rig, cx, Role::Alert), ["Could not save"]);
    assert_eq!(labels(&rig, cx, Role::Status), ["Saved"]);
    assert_eq!(labels(&rig, cx, Role::Note), ["Old news"]);
}
