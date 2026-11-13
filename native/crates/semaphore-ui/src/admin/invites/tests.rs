//! The instance invites page in a window: the create form's two rules, the draft it sends, the
//! link a copy asks for, the delete confirm, and what the caps turn off.

use super::InstanceInvitesPage;
use super::fixtures::*;
use crate::dms::rig::{Rig, rig};
use crate::panel::PanelClock;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{
    AdminActionKind as K, AdminInvitesView, AdminOp, InstanceAdminCaps, InstanceInviteDraft,
    LoadState,
};

fn invites_rig(
    cx: &mut TestAppContext,
    caps: InstanceAdminCaps,
    view: AdminInvitesView,
) -> Rig<InstanceInvitesPage, super::InstanceInvitesEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut page = InstanceInvitesPage::new(window, cx);
        page.set_caps(caps, cx);
        page.set_clock(PanelClock::fixed(1_000), cx);
        page.set_link_base("https://chat.example.com/".into(), cx);
        page.set_communities(communities(), cx);
        page.set_view(view, cx);
        page
    })
}

#[gpui_kit::test]
fn create_needs_a_community(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, owner(), ready());
    rig.click(cx, "admin-invites-create");
    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.pick_communities(&[], cx))
    });
    rig.click(cx, "admin-invites-create-submit");
    assert!(rig.events().is_empty(), "no community picked");
    assert!(
        rig.has(cx, "admin-invites-communities-error"),
        "the form says what is missing"
    );

    rig.with(cx, |view, _, cx| {
        view.update(cx, |page, cx| page.pick_communities(&["c-nightowl"], cx))
    });
    rig.click(cx, "admin-invites-create-submit");
    assert_eq!(
        rig.events(),
        [super::InstanceInvitesEvent::Create(InstanceInviteDraft {
            community_ids: vec!["c-nightowl".into()],
            max_uses: None,
            valid_until_ms: None,
        })]
    );
}

#[gpui_kit::test]
fn create_sends_the_draft(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, owner(), ready());
    rig.with(cx, |view, window, cx| {
        view.update(cx, |page, cx| {
            page.open_create(
                " 5 ",
                crate::community_settings::rules::ExpiryPreset::Week,
                false,
                window,
                cx,
            );
            page.pick_communities(&["c-northwind", "c-riverside"], cx);
        })
    });
    rig.click(cx, "admin-invites-create-submit");
    assert_eq!(
        rig.events(),
        [super::InstanceInvitesEvent::Create(InstanceInviteDraft {
            community_ids: vec!["c-northwind".into(), "c-riverside".into()],
            max_uses: Some(5),
            valid_until_ms: Some(1_000 + 7 * 24 * 60 * 60 * 1000),
        })]
    );
}

#[gpui_kit::test]
fn copy_link_uses_the_base(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, owner(), ready());
    rig.click(cx, "admin-invites-copy-aB3x9Q");
    assert_eq!(
        rig.events(),
        [super::InstanceInvitesEvent::CopyLink {
            url: "https://chat.example.com/#/join/aB3x9Q".into()
        }]
    );
}

#[gpui_kit::test]
fn delete_confirm_sends_delete(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, owner(), ready());
    rig.click(cx, "admin-invites-delete-fr33Pass");
    assert!(rig.events().is_empty(), "asks first");
    assert!(rig.has(cx, "admin-invites-delete-confirm"));
    rig.click(cx, "admin-invites-delete-cancel");
    assert!(rig.events().is_empty());
    rig.click(cx, "admin-invites-delete-fr33Pass");
    rig.click(cx, "admin-invites-delete-confirm");
    assert_eq!(
        rig.events(),
        [super::InstanceInvitesEvent::Delete {
            code: "fr33Pass".into()
        }]
    );
}

#[gpui_kit::test]
fn controls_follow_the_caps(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, reader(), ready());
    assert!(rig.has(cx, "admin-invites-create-locked"));
    rig.click(cx, "admin-invites-create");
    assert!(rig.events().is_empty());
    assert!(!rig.has(cx, "admin-invites-create-submit"));

    rig.click(cx, "admin-invites-delete-aB3x9Q");
    assert!(rig.events().is_empty());
    assert!(!rig.has(cx, "admin-invites-delete-confirm"));

    let rig = invites_rig(cx, InstanceAdminCaps::default(), ready());
    assert!(rig.has(cx, "admin-invites-denied"));
    assert!(!rig.has(cx, "admin-invites-list"));
}

#[gpui_kit::test]
fn a_failed_read_asks_again(cx: &mut TestAppContext) {
    let rig = invites_rig(cx, owner(), view(failed(), Vec::new(), AdminOp::default()));
    rig.click(cx, "admin-invites-retry");
    assert_eq!(rig.events(), [super::InstanceInvitesEvent::Retry]);
}

/// A create that fails stays in the form, beside the button that sent it.
#[gpui_kit::test]
fn a_refused_create_keeps_the_form(cx: &mut TestAppContext) {
    let rig = invites_rig(
        cx,
        owner(),
        view(
            LoadState::Ready,
            rows(),
            erred(K::CreateInstanceInvite, None, "Not your community."),
        ),
    );
    rig.with(cx, |view, window, cx| {
        view.update(cx, |page, cx| {
            page.open_create(
                "",
                crate::community_settings::rules::ExpiryPreset::Never,
                true,
                window,
                cx,
            )
        })
    });
    assert!(rig.has(cx, "admin-invites-create-submit"));
}
