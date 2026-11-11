//! The web's limits, the patch and the image checks, then the modal, the page and the edit form in
//! a window.

use super::view::{Shown, shown};
use super::*;
use crate::dms::rig::rig;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{
    ErrorView, ImageChange, LoadState, ProfileImage, ProfilePatch, ProfileUpload, UploadView,
    UserView,
};

fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn profile(is_me: bool) -> Profile {
    Profile {
        user: UserView {
            avatar_file_id: Some("file-a".into()),
            ..user("u-ava", "ava", Some("Ava Chen"))
        },
        bio: Some("Hello".into()),
        status: Some("Busy".into()),
        banner_file_id: Some("file-b".into()),
        is_me,
    }
}

fn ready(profile: Profile) -> ProfileView {
    ProfileView {
        state: LoadState::Ready,
        profile: Some(profile),
    }
}

fn error(code: &str) -> ErrorView {
    ErrorView {
        code: code.into(),
        message: "nope".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn png(bytes: usize) -> DraftFile {
    DraftFile {
        name: "a.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![0; bytes],
    }
}

#[test]
fn display_name_bio_and_status_have_the_webs_limits() {
    let draft = |name: &str, status: &str, bio: &str| ProfileDraft {
        display_name: name.into(),
        status: status.into(),
        bio: bio.into(),
        ..ProfileDraft::default()
    };
    assert!(validate_profile(&draft("Ava", "", "")).is_empty());
    assert_eq!(
        validate_profile(&draft("   ", "", "")),
        [(
            ProfileField::DisplayName,
            "Display name is required".to_owned()
        )]
    );
    assert!(validate_profile(&draft(&format!("  {}  ", "a".repeat(32)), "", "")).is_empty());
    assert_eq!(
        validate_profile(&draft(&"a".repeat(33), "", ""))[0].0,
        ProfileField::DisplayName
    );
    let errors = validate_profile(&draft("Ava", &"s".repeat(129), &"b".repeat(501)));
    let fields: Vec<_> = errors.iter().map(|(field, _)| *field).collect();
    assert_eq!(fields, [ProfileField::Bio, ProfileField::Status]);
    assert!(validate_profile(&draft("Ava", &"s".repeat(128), &"é".repeat(500))).is_empty());
}

#[test]
fn the_patch_has_only_what_changed() {
    let base = profile(true);
    let same = ProfileDraft::from_profile(&base);
    assert_eq!(same.patch(&base), ProfilePatch::default());
    assert!(!same.is_dirty(&base));

    let changed = ProfileDraft {
        display_name: "  Ava C  ".into(),
        status: String::new(),
        avatar: Some(ImageChange::Remove),
        ..same.clone()
    };
    assert_eq!(
        changed.patch(&base),
        ProfilePatch {
            display_name: Some("Ava C".into()),
            status: Some(String::new()),
            bio: None,
            avatar: Some(ImageChange::Remove),
            banner: None,
        }
    );

    // No display name of its own: the field starts as the username.
    let mut plain = base.clone();
    plain.user.display_name = None;
    let draft = ProfileDraft::from_profile(&plain);
    assert_eq!(draft.display_name, "ava");
    assert_eq!(draft.patch(&plain), ProfilePatch::default());
}

#[test]
fn only_images_within_the_limit_are_taken() {
    assert!(check_image(&png(10), Some(100)).is_ok());
    assert!(check_image(&png(10), None).is_ok());
    assert_eq!(
        check_image(&png(12 * 1024 * 1024), Some(8 * 1024 * 1024)),
        Err("That image is 12 MB; the limit is 8 MB".to_owned())
    );
    let pdf = DraftFile {
        mime_type: "application/pdf".into(),
        ..png(10)
    };
    assert_eq!(
        check_image(&pdf, None),
        Err("Choose a PNG, JPEG, GIF or WebP image".to_owned())
    );
}

#[test]
fn initials_and_what_a_view_shows() {
    assert_eq!(profile_initials("ava chen"), "AV");
    assert_eq!(profile_initials("é"), "É");
    assert!(matches!(shown(&ProfileView::default()), Shown::Loading));
    let not_found = ProfileView {
        state: LoadState::Failed {
            error: error("NOT_FOUND"),
        },
        profile: None,
    };
    assert!(matches!(shown(&not_found), Shown::NotFound));
    let failed = ProfileView {
        state: LoadState::Failed {
            error: error("NETWORK"),
        },
        profile: None,
    };
    assert!(matches!(shown(&failed), Shown::Failed));
    assert!(matches!(shown(&ready(profile(false))), Shown::Ready(_)));
}

#[gpui_kit::test]
fn the_modal_messages_opens_the_page_and_retries(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., |_, cx| {
        let mut modal = ProfileModal::new("u-ava", cx);
        modal.set_view(ready(profile(false)), cx);
        modal.set_actions(
            ProfileActions {
                can_message: true,
                friend: FriendAction::Add,
            },
            cx,
        );
        modal
    });
    rig.click(cx, "profile-message");
    rig.click(cx, "profile-add-friend");
    rig.click(cx, "profile-view-page");
    rig.click(cx, "profile-close");
    let ava = || "u-ava".to_owned();
    assert_eq!(
        rig.events(),
        [
            ProfileEvent::Message { user_id: ava() },
            ProfileEvent::AddFriend { user_id: ava() },
            ProfileEvent::OpenPage { user_id: ava() },
            ProfileEvent::Close,
        ]
    );
    rig.clear();
    rig.with(cx, |modal, _, cx| {
        modal.update(cx, |modal, cx| {
            modal.set_view(
                ProfileView {
                    state: LoadState::Failed {
                        error: error("NETWORK"),
                    },
                    profile: None,
                },
                cx,
            )
        })
    });
    rig.click(cx, "profile-retry");
    assert_eq!(rig.events(), [ProfileEvent::Retry]);
}

#[gpui_kit::test]
fn ones_own_profile_has_no_message_and_the_page_edits(cx: &mut TestAppContext) {
    let modal = rig(cx, 1000., |_, cx| {
        let mut modal = ProfileModal::new("u-ava", cx);
        modal.set_view(ready(profile(true)), cx);
        modal.set_actions(
            ProfileActions {
                can_message: true,
                friend: FriendAction::Add,
            },
            cx,
        );
        modal
    });
    assert!(!modal.has(cx, "profile-message"));
    assert!(!modal.has(cx, "profile-add-friend"));
    assert!(modal.has(cx, "profile-view-page"));

    let page = rig(cx, 1000., |_, cx| {
        let mut page = ProfilePage::new("u-ava", cx);
        page.set_view(ready(profile(true)), cx);
        page
    });
    page.click(cx, "profile-edit");
    page.click(cx, "profile-back");
    assert_eq!(page.events(), [ProfileEvent::Edit, ProfileEvent::Back]);

    let other = rig(cx, 390., |_, cx| {
        let mut page = ProfilePage::new("u-ava", cx);
        page.set_view(ready(profile(false)), cx);
        page.set_actions(
            ProfileActions {
                can_message: false,
                friend: FriendAction::Friends,
            },
            cx,
        );
        page
    });
    assert!(!other.has(cx, "profile-edit"));
    assert!(!other.has(cx, "profile-message"));
    assert!(other.has(cx, "profile-friends"));
}

fn edit_form(cx: &mut TestAppContext) -> crate::dms::rig::Rig<ProfileEditForm, ProfileEditEvent> {
    rig(cx, 1280., |window, cx| {
        let mut form = ProfileEditForm::new(window, cx);
        form.set_max_file_bytes(Some(1000), cx);
        form.set_view(ready(profile(true)), window, cx);
        form
    })
}

fn preset(
    rig: &crate::dms::rig::Rig<ProfileEditForm, ProfileEditEvent>,
    cx: &mut TestAppContext,
    name: &str,
) {
    let name = name.to_owned();
    rig.with(cx, move |form, window, cx| {
        form.update(cx, |form, cx| {
            form.preset(&name, "Busy", "Hello", window, cx)
        })
    });
}

#[gpui_kit::test]
fn save_sends_the_changes_and_an_invalid_form_sends_nothing(cx: &mut TestAppContext) {
    let rig = edit_form(cx);
    let draft = rig.with(cx, |form, _, cx| form.read(cx).draft(cx));
    assert_eq!(draft.display_name, "Ava Chen", "filled from the profile");

    preset(&rig, cx, &"x".repeat(40));
    rig.click(cx, "profile-save");
    assert!(rig.events().is_empty());
    assert!(
        rig.has(cx, "profile-display-name"),
        "the field is still there with its error"
    );

    preset(&rig, cx, "Ava");
    rig.click(cx, "profile-save");
    assert_eq!(
        rig.events(),
        [ProfileEditEvent::Save {
            patch: Box::new(ProfilePatch {
                display_name: Some("Ava".into()),
                ..ProfilePatch::default()
            })
        }]
    );
}

#[gpui_kit::test]
fn the_pickers_ask_for_files_reject_bad_ones_and_remove(cx: &mut TestAppContext) {
    let rig = edit_form(cx);
    rig.click(cx, "profile-avatar-change");
    rig.click(cx, "profile-banner-change");
    assert_eq!(
        rig.events(),
        [
            ProfileEditEvent::PickImage {
                slot: ImageSlot::Avatar
            },
            ProfileEditEvent::PickImage {
                slot: ImageSlot::Banner
            },
        ]
    );
    rig.clear();
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| {
            form.set_picked(ImageSlot::Avatar, png(5000), cx);
            form.set_picked(ImageSlot::Banner, png(10), cx);
        })
    });
    assert!(
        rig.has(cx, "profile-avatar-error"),
        "too large for the limit"
    );
    assert!(!rig.has(cx, "profile-banner-error"));
    rig.click(cx, "profile-avatar-remove");
    assert!(
        !rig.has(cx, "profile-avatar-error"),
        "removing clears the error"
    );
    rig.click(cx, "profile-save");
    assert_eq!(
        rig.events(),
        [ProfileEditEvent::Save {
            patch: Box::new(ProfilePatch {
                avatar: Some(ImageChange::Remove),
                banner: Some(ImageChange::Set { file: png(10) }),
                ..ProfilePatch::default()
            })
        }]
    );
}

#[gpui_kit::test]
fn a_busy_form_waits_and_a_finished_edit_drops_the_picks(cx: &mut TestAppContext) {
    let rig = edit_form(cx);
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| {
            form.set_picked(ImageSlot::Banner, png(10), cx);
            form.set_edit(
                ProfileEditView {
                    saving: true,
                    upload: Some(ProfileUpload {
                        image: ProfileImage::Banner,
                        upload: UploadView {
                            name: "a.png".into(),
                            size_bytes: 10,
                            sent_bytes: 4,
                            failed: None,
                        },
                    }),
                    error: None,
                },
                cx,
            );
        })
    });
    assert!(rig.has(cx, "profile-upload"));
    rig.click(cx, "profile-save");
    rig.click(cx, "profile-banner-change");
    rig.click(cx, "profile-cancel");
    assert!(rig.events().is_empty(), "everything waits while saving");
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| form.set_edit(ProfileEditView::default(), cx))
    });
    assert!(!rig.has(cx, "profile-upload"));
    let draft = rig.with(cx, |form, _, cx| form.read(cx).draft(cx));
    assert_eq!(draft.banner, None, "saved: the pick is the profile's now");

    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| {
            form.set_edit(
                ProfileEditView {
                    saving: false,
                    upload: None,
                    error: Some(error("BAD_REQUEST")),
                },
                cx,
            )
        })
    });
    assert!(rig.has(cx, "profile-edit-error"));
}

#[gpui_kit::test]
fn a_profile_that_failed_to_load_retries(cx: &mut TestAppContext) {
    let rig = rig(cx, 390., |window, cx| {
        let mut form = ProfileEditForm::new(window, cx);
        form.set_view(
            ProfileView {
                state: LoadState::Failed {
                    error: error("NETWORK"),
                },
                profile: None,
            },
            window,
            cx,
        );
        form
    });
    rig.click(cx, "profile-edit-retry");
    rig.click(cx, "profile-edit-back");
    assert_eq!(
        rig.events(),
        [ProfileEditEvent::Retry, ProfileEditEvent::Cancel]
    );
}
