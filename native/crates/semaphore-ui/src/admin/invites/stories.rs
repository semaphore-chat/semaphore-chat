//! The instance invites stories: loading, empty, failed, ready with each status, forty long rows,
//! the create dialog filled in, invalid, busy and refused, an invite just copied, a delete refused,
//! a reader who may only list them, and the phone layout.
//! `rigs/shot/scripts/ua4-admin-communities-invites.steps` renders them on a desktop (dark) and a
//! phone (light).

use super::InstanceInvitesPage;
use super::fixtures::*;
use crate::community_settings::rules::ExpiryPreset;
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{
    AdminActionKind as K, AdminInvitesView, AdminOp, InstanceAdminCaps, LoadState,
};

fn build(
    caps: InstanceAdminCaps,
    view: AdminInvitesView,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut InstanceInvitesPage, &mut Window, &mut Context<InstanceInvitesPage>),
) -> AnyView {
    cx.new(|cx| {
        let mut page = InstanceInvitesPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_clock(PanelClock::fixed(now()), cx);
        page.set_time(TimeFormat::fixed(now()), cx);
        page.set_link_base("https://chat.example.com".into(), cx);
        page.set_communities(communities(), cx);
        page.set_view(view, cx);
        tweak(&mut page, window, cx);
        page
    })
    .into()
}

fn plain(
    caps: InstanceAdminCaps,
    view: AdminInvitesView,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    build(caps, view, window, cx, |_, _, _| {})
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(super) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        ("admin-invites-loading", |_, w, cx| {
            plain(
                owner(),
                view(LoadState::Loading, Vec::new(), AdminOp::default()),
                w,
                cx,
            )
        }),
        ("admin-invites-empty", |_, w, cx| {
            plain(
                owner(),
                view(LoadState::Ready, Vec::new(), AdminOp::default()),
                w,
                cx,
            )
        }),
        ("admin-invites-failed", |_, w, cx| {
            plain(
                owner(),
                view(failed(), Vec::new(), AdminOp::default()),
                w,
                cx,
            )
        }),
        ("admin-invites-ready", |_, w, cx| {
            plain(owner(), ready(), w, cx)
        }),
        ("admin-invites-long", |_, w, cx| {
            plain(
                owner(),
                view(LoadState::Ready, long_rows(), AdminOp::default()),
                w,
                cx,
            )
        }),
        ("admin-invites-create", |_, w, cx| {
            build(owner(), ready(), w, cx, |page, window, cx| {
                page.open_create("25", ExpiryPreset::Week, false, window, cx);
            })
        }),
        ("admin-invites-create-invalid", |_, w, cx| {
            build(owner(), ready(), w, cx, |page, window, cx| {
                page.open_create("0", ExpiryPreset::Never, true, window, cx);
                page.pick_communities(&[], cx);
            })
        }),
        ("admin-invites-create-busy", |_, w, cx| {
            build(
                owner(),
                view(
                    LoadState::Ready,
                    rows(),
                    busy(K::CreateInstanceInvite, None),
                ),
                w,
                cx,
                |page, window, cx| {
                    page.open_create("5", ExpiryPreset::Day, true, window, cx);
                },
            )
        }),
        ("admin-invites-create-refused", |_, w, cx| {
            build(
                owner(),
                view(
                    LoadState::Ready,
                    rows(),
                    erred(
                        K::CreateInstanceInvite,
                        None,
                        "You need the \u{201c}Create invites\u{201d} permission on every community you pick.",
                    ),
                ),
                w,
                cx,
                |page, window, cx| {
                    page.open_create("5", ExpiryPreset::Day, true, window, cx);
                },
            )
        }),
        ("admin-invites-copied", |_, w, cx| {
            build(owner(), ready(), w, cx, |page, _, _| {
                page.mark_copied("fr33Pass");
            })
        }),
        ("admin-invites-delete-refused", |_, w, cx| {
            plain(
                owner(),
                view(
                    LoadState::Ready,
                    rows(),
                    erred(
                        K::DeleteInstanceInvite,
                        Some("aB3x9Q"),
                        "Only the invite's creator can delete it.",
                    ),
                ),
                w,
                cx,
            )
        }),
        ("admin-invites-limited", |_, w, cx| {
            plain(reader(), ready(), w, cx)
        }),
        ("admin-invites-phone", |_, w, cx| {
            build(owner(), ready(), w, cx, |page, _, _| {
                page.open_delete("fr33Pass");
            })
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
