//! MediaTile (K3): its name, the avatar's step-down by tile width, "Unknown user", the speaking
//! state, the 16:9 box and the video slot, against the web kit's `MediaTile.test.tsx`.

use super::{
    AvatarSize, MediaKind, MediaTile, VideoFit, VideoSlot, media_step, media_tile_breakpoints,
    media_tile_label,
};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::lounge::{AVATAR_XL, RADIUS_CARD, SPACE_MD, SPACE_SM, TEXT_META};
use std::cell::RefCell;
use std::rc::Rc;

#[test]
fn the_name_is_the_label_with_speaking_and_never_blank() {
    assert_eq!(media_tile_label("pri", false), "pri");
    assert_eq!(media_tile_label("pri", true), "pri, speaking");
    assert_eq!(media_tile_label(" ", false), "Unknown user");
    assert_eq!(media_tile_label("", true), "Unknown user, speaking");
}

#[test]
fn the_breakpoints_come_from_the_tokens() {
    let need = ((2. * SPACE_MD + AVATAR_XL + SPACE_SM + TEXT_META.line_height) * 16. / 9.).ceil();
    let [xl, lg, md] = media_tile_breakpoints();
    assert_eq!(xl, need);
    assert!(xl > lg && lg > md && md > 0., "{xl} {lg} {md}");
}

#[test]
fn the_avatar_steps_down_then_the_padding_then_the_label_goes() {
    let [xl, lg, md] = media_tile_breakpoints();
    let at = |width: f32| {
        let step = media_step(width);
        (step.avatar, step.padding, step.label)
    };
    assert_eq!(at(1000.), (AvatarSize::Xl, SPACE_MD, true));
    assert_eq!(at(xl), (AvatarSize::Xl, SPACE_MD, true));
    assert_eq!(at(xl - 1.), (AvatarSize::Lg, SPACE_MD, true));
    assert_eq!(at(lg), (AvatarSize::Lg, SPACE_MD, true));
    assert_eq!(at(lg - 1.), (AvatarSize::Md, SPACE_SM, true));
    assert_eq!(at(md), (AvatarSize::Md, SPACE_SM, true));
    assert_eq!(at(md - 1.), (AvatarSize::Md, SPACE_SM, false));
    assert_eq!(at(0.), (AvatarSize::Md, SPACE_SM, false));
}

#[test]
fn a_screen_is_shown_whole_and_a_camera_fills_the_box() {
    assert_eq!(MediaKind::Screen.fit(), VideoFit::Contain);
    assert_eq!(MediaKind::Camera.fit(), VideoFit::Cover);
}

type Build = Rc<dyn Fn() -> AnyElement>;

/// A view drawing whatever `build` makes in a box `width` px wide.
struct Host {
    width: f32,
    build: Build,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .p(px(8.))
            .child(div().w(px(self.width)).child((self.build)()))
    }
}

fn host(
    cx: &mut TestAppContext,
    width: f32,
    build: impl Fn() -> AnyElement + 'static,
) -> Rig<Host, ()> {
    let build: Build = Rc::new(build);
    rig(cx, 800., move |_, _| Host { width, build })
}

fn group_labels(rig: &Rig<Host, ()>, cx: &mut TestAppContext) -> Vec<String> {
    rig.with(cx, |_, window, _| {
        window
            .find_all_by_role(Role::Group)
            .iter()
            .map(|node| node.label().unwrap_or_default().to_owned())
            .collect()
    })
}

#[gpui_kit::test]
fn a_tile_is_a_group_named_by_its_label(cx: &mut TestAppContext) {
    let rig = host(cx, 320., || {
        div()
            .child(MediaTile::new("a", "pri", MediaKind::Camera))
            .child(MediaTile::new("b", " ", MediaKind::Avatar))
            .child(MediaTile::new("c", "aiko", MediaKind::Screen).speaking(true))
            .into_any_element()
    });
    assert_eq!(
        group_labels(&rig, cx),
        ["pri", "Unknown user", "aiko, speaking"]
    );
    // The avatar inside is decorative: the group carries the name.
    rig.with(cx, |_, window, _| {
        assert!(window.find_all_by_role(Role::Image).is_empty());
    });
}

#[gpui_kit::test]
fn a_tile_is_16_by_9_and_as_wide_as_its_container(cx: &mut TestAppContext) {
    let rig = host(cx, 320., || {
        MediaTile::new("t", "pri", MediaKind::Avatar).into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let bounds = window.find("t").bounds();
        assert_eq!(bounds.size.width, px(320.));
        assert_eq!(bounds.size.height, px(180.));
    });
}

fn drawn_avatar(cx: &mut TestAppContext, width: f32) -> Vec<(String, f32)> {
    let rig = host(cx, width, || {
        MediaTile::new("t", "dropbear", MediaKind::Avatar).into_any_element()
    });
    rig.with(cx, |_, window, _| {
        AvatarSize::ALL
            .into_iter()
            .filter_map(|size| {
                let id = SharedString::from(format!("media-avatar-{}", size.name()));
                window
                    .try_find(id.clone())
                    .map(|node| (size.name().to_owned(), f32::from(node.bounds().size.width)))
            })
            .collect()
    })
}

#[gpui_kit::test]
fn the_drawn_avatar_steps_down_with_the_tiles_width(cx: &mut TestAppContext) {
    let [xl, lg, md] = media_tile_breakpoints();
    for (width, size) in [
        (400., AvatarSize::Xl),
        (xl, AvatarSize::Xl),
        (xl - 1., AvatarSize::Lg),
        (lg - 1., AvatarSize::Md),
        (md - 1., AvatarSize::Md),
    ] {
        assert_eq!(
            drawn_avatar(cx, width),
            [(size.name().to_owned(), size.px())],
            "at {width} px"
        );
    }
}

#[gpui_kit::test]
fn only_an_avatar_tile_draws_an_avatar(cx: &mut TestAppContext) {
    let rig = host(cx, 320., || {
        MediaTile::new("t", "dropbear's screen", MediaKind::Screen).into_any_element()
    });
    rig.with(cx, |_, window, _| {
        for size in AvatarSize::ALL {
            let id = SharedString::from(format!("media-avatar-{}", size.name()));
            assert!(window.try_find(id.clone()).is_none(), "{id}");
        }
    });
}

#[gpui_kit::test]
fn the_video_slot_fills_the_tile_with_its_fit_and_radius(cx: &mut TestAppContext) {
    let seen: Rc<RefCell<Vec<VideoSlot>>> = Rc::default();
    let record = seen.clone();
    let rig = host(cx, 320., move || {
        let record = record.clone();
        MediaTile::new("t", "aiko's screen", MediaKind::Screen)
            .video(move |slot| {
                record.borrow_mut().push(slot);
                div()
                    .id("video")
                    .test_support()
                    .size_full()
                    .into_any_element()
            })
            .into_any_element()
    });
    let slot = *seen.borrow().last().expect("the slot was built");
    assert_eq!(slot.fit, VideoFit::Contain);
    assert_eq!(slot.radius, px(RADIUS_CARD));
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("video").bounds(), window.find("t").bounds());
        // Over video there is no avatar, at any width.
        assert!(window.try_find("media-avatar-xl").is_none());
    });
}

#[gpui_kit::test]
fn an_avatar_tile_never_builds_the_video(cx: &mut TestAppContext) {
    let built = Rc::new(RefCell::new(false));
    let flag = built.clone();
    let _rig = host(cx, 320., move || {
        let flag = flag.clone();
        MediaTile::new("t", "pri", MediaKind::Avatar)
            .video(move |_| {
                *flag.borrow_mut() = true;
                div().into_any_element()
            })
            .into_any_element()
    });
    assert!(!*built.borrow());
}

#[gpui_kit::test]
fn speaking_is_in_the_name_and_the_ring_never_moves_the_box(cx: &mut TestAppContext) {
    let rig = host(cx, 320., || {
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(MediaTile::new("quiet", "pri", MediaKind::Camera))
            .child(MediaTile::new("loud", "pri", MediaKind::Camera).speaking(true))
            .into_any_element()
    });
    assert_eq!(group_labels(&rig, cx), ["pri", "pri, speaking"]);
    rig.with(cx, |_, window, _| {
        let quiet = window.find("quiet").bounds();
        let loud = window.find("loud").bounds();
        assert_eq!(quiet.size, loud.size);
        assert_eq!(loud.origin.y, quiet.origin.y + quiet.size.height + px(8.));
    });
}
