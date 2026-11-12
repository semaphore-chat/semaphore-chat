//! The rules first, table by table (names at and over the limit with unicode, duplicates, what a
//! save sends, the group checkbox, moving, assignment changes, the presets), with property-style
//! checks where cheap; then the views in a window: what each control sends.

use super::rules::*;
use super::*;
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminActionState, AdminOp, ChannelOverwritesView, ChannelPreset,
    DetectedPreset, ErrorView, LoadState, MemberRolesView, OverwriteRoleOption, OverwriteRow,
    OverwriteTarget, PermissionGroup, PresetAccess, RoleBlock, RoleDraft, RolePatch, RoleRow,
    RolesView,
};
use std::collections::BTreeSet;

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

fn role(id: &str, name: &str, actions: &[&str]) -> RoleRow {
    RoleRow {
        id: id.into(),
        name: name.into(),
        actions: strings(actions),
        editable: true,
        deletable: true,
        assignable: true,
        ..RoleRow::default()
    }
}

fn member() -> RoleRow {
    RoleRow {
        fixed: true,
        is_default: true,
        ..role("r-member", "Member", &["READ_MESSAGE"])
    }
}

// ---- Names. ----

#[test]
fn role_names_need_one_to_fifty_characters_once_trimmed() {
    let fifty = "a".repeat(50);
    let cases: Vec<(String, Result<(), NameError>)> = vec![
        ("".into(), Err(NameError::Required)),
        ("   ".into(), Err(NameError::Required)),
        ("\t\n".into(), Err(NameError::Required)),
        ("a".into(), Ok(())),
        (fifty.clone(), Ok(())),
        (format!("  {fifty}  "), Ok(())),
        ("a".repeat(51), Err(NameError::TooLong)),
        // Characters, not bytes: 50 two-byte letters fit.
        ("é".repeat(50), Ok(())),
        ("é".repeat(51), Err(NameError::TooLong)),
        // A combining mark is a character of its own: 25 × (e + U+0301) is 50.
        ("e\u{301}".repeat(25), Ok(())),
        (
            format!("{}x", "e\u{301}".repeat(25)),
            Err(NameError::TooLong),
        ),
        // An emoji is one character; a ZWJ family is each of its parts.
        ("\u{1f44d}".repeat(50), Ok(())),
        ("\u{1f44d}".repeat(51), Err(NameError::TooLong)),
        // 👨‍👩‍👧 is 5 code points: 10 of them are 50.
        (
            "\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}".repeat(10),
            Ok(()),
        ),
        (
            format!(
                "{}a",
                "\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}".repeat(10)
            ),
            Err(NameError::TooLong),
        ),
        ("\u{4e2d}\u{6587}".into(), Ok(())),
    ];
    for (typed, expected) in cases {
        assert_eq!(check_role_name(&typed, []), expected, "{typed:?}");
    }
}

#[test]
fn duplicate_names_are_exact_after_trimming() {
    let others = ["Moderator", "Event Hosts ", "Bots"];
    for (typed, expected) in [
        ("Moderator", Err(NameError::Taken)),
        ("  Moderator  ", Err(NameError::Taken)),
        ("Event Hosts", Err(NameError::Taken)),
        ("moderator", Ok(())),
        ("MODERATOR", Ok(())),
        ("Moderators", Ok(())),
        ("Bot s", Ok(())),
    ] {
        assert_eq!(check_role_name(typed, others), expected, "{typed:?}");
    }
    // The role's own name is left out by the caller: renaming to itself is fine.
    assert_eq!(check_role_name("Bots", ["Moderator"]), Ok(()));
}

#[test]
fn name_problems_come_before_permission_problems() {
    let mut draft = RoleDraftState::create();
    assert_eq!(draft.problem([]), Some("Role name is required".into()));
    draft.name = "Crew".into();
    assert_eq!(
        draft.problem([]),
        Some("Role must have at least one permission".into())
    );
    draft.actions.insert("SPEAK".into());
    assert_eq!(draft.problem([]), None);
    assert_eq!(
        draft.problem(["Crew"]),
        Some("A role with this name already exists".into())
    );
}

// ---- What a save sends. ----

#[test]
fn an_edit_sends_only_what_changed() {
    let base = role("r", "Hosts", &["SPEAK", "READ_MESSAGE"]);
    let cases: Vec<(&str, &[&str], RolePatch)> = vec![
        ("Hosts", &["SPEAK", "READ_MESSAGE"], RolePatch::default()),
        ("  Hosts ", &["SPEAK", "READ_MESSAGE"], RolePatch::default()),
        ("Hosts", &["READ_MESSAGE", "SPEAK"], RolePatch::default()),
        (
            "Hosts!",
            &["SPEAK", "READ_MESSAGE"],
            RolePatch {
                name: Some("Hosts!".into()),
                actions: None,
            },
        ),
        (
            " Crew ",
            &["SPEAK", "READ_MESSAGE"],
            RolePatch {
                name: Some("Crew".into()),
                actions: None,
            },
        ),
        (
            "Hosts",
            &["SPEAK"],
            RolePatch {
                name: None,
                actions: Some(strings(&["SPEAK"])),
            },
        ),
        (
            "hosts",
            &["SPEAK", "READ_MESSAGE", "VIDEO"],
            RolePatch {
                name: Some("hosts".into()),
                actions: Some(strings(&["READ_MESSAGE", "SPEAK", "VIDEO"])),
            },
        ),
    ];
    for (name, actions, expected) in cases {
        let mut draft = RoleDraftState::edit(&base);
        draft.name = name.into();
        draft.actions = set(actions);
        assert_eq!(draft.changes(), expected, "{name:?} {actions:?}");
        assert_eq!(draft.is_dirty(), !patch_is_empty(&expected));
    }
}

#[test]
fn a_new_role_is_always_dirty_and_sends_its_trimmed_name() {
    let mut draft = RoleDraftState::create();
    assert!(draft.is_dirty());
    draft.name = "  Crew ".into();
    assert_eq!(draft.changes().name.as_deref(), Some("Crew"));
}

#[test]
fn a_draft_against_itself_changes_nothing() {
    for actions in [&[][..], &["SPEAK"], &["SPEAK", "X_UNKNOWN", "READ_MESSAGE"]] {
        for name in ["a", " spaced ", "\u{1f44d}"] {
            let draft = RoleDraftState::edit(&role("r", name, actions));
            assert!(patch_is_empty(&draft.changes()), "{name:?} {actions:?}");
            assert!(!draft.is_dirty());
        }
    }
}

#[test]
fn toggling_twice_returns_to_the_original() {
    let grantable = set(&["SPEAK", "VIDEO", "READ_MESSAGE"]);
    let group = strings(&["SPEAK", "VIDEO", "BAN_USER"]);
    for start in [&[][..], &["SPEAK"], &["SPEAK", "VIDEO", "BAN_USER"]] {
        let original = RoleDraftState::edit(&role("r", "R", start));
        for action in ["SPEAK", "VIDEO", "READ_MESSAGE", "BAN_USER", "X_UNKNOWN"] {
            let mut draft = original.clone();
            draft.toggle(action, &grantable);
            draft.toggle(action, &grantable);
            assert_eq!(draft, original, "{action} from {start:?}");
        }
        let mut draft = original.clone();
        draft.toggle_group(&group, &grantable);
        draft.toggle_group(&group, &grantable);
        // A group press then another lands on all-off or all-on for what may be granted, so it
        // returns to the start only when the start was one of those.
        let mine_on = ["SPEAK", "VIDEO"]
            .iter()
            .filter(|a| original.actions.contains(**a))
            .count();
        if mine_on == 0 || mine_on == 2 {
            assert_eq!(draft, original, "group from {start:?}");
        }
    }
}

#[test]
fn unknown_and_ungrantable_actions_survive_every_toggle() {
    let grantable = set(&["SPEAK", "VIDEO"]);
    let catalog = vec![PermissionGroup {
        id: "voice".into(),
        actions: strings(&["SPEAK", "VIDEO", "BAN_USER"]),
    }];
    let mut draft = RoleDraftState::edit(&role("r", "R", &["X_UNKNOWN", "BAN_USER", "SPEAK"]));
    let sequence = ["SPEAK", "X_UNKNOWN", "BAN_USER", "VIDEO", "SPEAK", "VIDEO"];
    for (step, action) in sequence.iter().enumerate() {
        draft.toggle(action, &grantable);
        if step % 2 == 0 {
            draft.toggle_group(&catalog[0].actions, &grantable);
        }
        assert!(draft.actions.contains("X_UNKNOWN"), "step {step}");
        assert!(draft.actions.contains("BAN_USER"), "step {step}");
        let patch = draft.changes();
        if let Some(actions) = patch.actions {
            assert!(actions.iter().any(|a| a == "X_UNKNOWN"));
        }
    }
    let groups = matrix_groups(&catalog, &draft.actions);
    assert_eq!(groups.last().map(|g| g.id.as_str()), Some(OTHER_GROUP));
    assert_eq!(
        groups.last().map(|g| g.actions.clone()),
        Some(strings(&["X_UNKNOWN"]))
    );
}

// ---- The group checkbox. ----

#[test]
fn the_group_checkbox_counts_everything_on() {
    let group = strings(&["A", "B", "C"]);
    for (on, expected) in [
        (&[][..], Tri::None),
        (&["A"], Tri::Some),
        (&["A", "B"], Tri::Some),
        (&["A", "B", "C"], Tri::All),
        // Actions outside the group don't count.
        (&["Z"], Tri::None),
        (&["A", "B", "C", "Z"], Tri::All),
    ] {
        let draft = RoleDraftState::edit(&role("r", "R", on));
        assert_eq!(draft.group_state(&group), expected, "{on:?}");
    }
}

#[test]
fn the_group_checkbox_turns_only_what_may_be_granted() {
    let group = strings(&["A", "B", "C"]);
    let grantable = set(&["A", "B"]);
    // (start, after one press)
    for (start, after) in [
        (&[][..], &["A", "B"][..]),
        (&["A"], &["A", "B"]),
        (&["A", "B"], &[]),
        (&["C"], &["A", "B", "C"]),
        (&["A", "B", "C"], &["C"]),
    ] {
        let mut draft = RoleDraftState::edit(&role("r", "R", start));
        draft.toggle_group(&group, &grantable);
        assert_eq!(draft.actions, set(after), "{start:?}");
    }
    // Nothing grantable: the press does nothing.
    let mut draft = RoleDraftState::edit(&role("r", "R", &["C"]));
    draft.toggle_group(&group, &set(&[]));
    assert_eq!(draft.actions, set(&["C"]));
}

// ---- Moving. ----

#[test]
fn moving_swaps_neighbours_and_never_includes_member() {
    let roles = vec![
        role("a", "A", &[]),
        role("b", "B", &[]),
        role("c", "C", &[]),
        member(),
    ];
    for (id, up, expected) in [
        ("a", true, None),
        ("a", false, Some(vec!["b", "a", "c"])),
        ("b", true, Some(vec!["b", "a", "c"])),
        ("b", false, Some(vec!["a", "c", "b"])),
        ("c", true, Some(vec!["a", "c", "b"])),
        // The last before Member can't go below it.
        ("c", false, None),
        ("r-member", true, None),
        ("missing", true, None),
    ] {
        let expected = expected.map(|ids: Vec<&str>| strings(&ids));
        assert_eq!(moved_order(&roles, id, up), expected, "{id} up={up}");
    }
    assert_eq!(
        moved_order(&[role("a", "A", &[]), member()], "a", true),
        None
    );
    assert_eq!(
        moved_order(&[role("a", "A", &[]), member()], "a", false),
        None
    );
}

#[test]
fn move_arrows_follow_core_and_say_why() {
    let mut view = RolesView {
        can_reorder: true,
        ..RolesView::default()
    };
    let mut row = role("a", "A", &[]);
    row.can_move_up = true;
    assert_eq!(move_block(&view, &row, true, false), None);
    assert!(move_block(&view, &row, false, false).is_some());
    assert_eq!(
        move_block(&view, &row, true, true).as_deref(),
        Some("Moving roles\u{2026}")
    );
    view.can_reorder = false;
    assert_eq!(
        move_block(&view, &row, true, false),
        Some(needs("UPDATE_ROLE"))
    );
}

#[test]
fn role_blocks_read_as_sentences() {
    for (change, block, expected) in [
        (
            RoleChange::Edit,
            Some(RoleBlock::Missing),
            needs("UPDATE_ROLE"),
        ),
        (
            RoleChange::Delete,
            Some(RoleBlock::Missing),
            needs("DELETE_ROLE"),
        ),
        (
            RoleChange::Assign,
            Some(RoleBlock::Missing),
            needs("UPDATE_MEMBER"),
        ),
        (
            RoleChange::Edit,
            Some(RoleBlock::Rank),
            "This role ranks at or above yours".into(),
        ),
        (
            RoleChange::Assign,
            Some(RoleBlock::HoldsUngrantable),
            "This role has permissions you don't have".into(),
        ),
        (
            RoleChange::Delete,
            Some(RoleBlock::DefaultRole),
            "Default roles can't be deleted".into(),
        ),
        (
            RoleChange::Delete,
            None,
            "You can't delete this role".into(),
        ),
    ] {
        assert_eq!(block_reason(change, block), expected);
    }
    let mut row = role("a", "A", &[]);
    assert_eq!(edit_block(&row), None);
    row.editable = false;
    row.edit_blocked = Some(RoleBlock::Rank);
    assert_eq!(
        edit_block(&row).as_deref(),
        Some("This role ranks at or above yours")
    );
}

// ---- Ops. ----

fn state(kind: AdminActionKind, target: Option<&str>, busy: bool, error: bool) -> AdminActionState {
    AdminActionState {
        action: AdminAction {
            kind,
            target_id: target.map(str::to_owned),
        },
        busy,
        upload: None,
        error: error.then(|| ErrorView {
            code: "X".into(),
            message: "nope".into(),
            retryable: false,
            retry_after_ms: None,
        }),
    }
}

fn op(actions: Vec<AdminActionState>) -> AdminOp {
    AdminOp {
        busy: actions.iter().any(|a| a.busy),
        actions,
        ..AdminOp::default()
    }
}

#[test]
fn each_change_reads_its_own_entry() {
    let delete_a = role_action(AdminActionKind::DeleteRole, Some("a"));
    let delete_b = role_action(AdminActionKind::DeleteRole, Some("b"));
    let both = op(vec![
        state(AdminActionKind::DeleteRole, Some("a"), true, false),
        state(AdminActionKind::DeleteRole, Some("b"), false, true),
    ]);
    assert!(running(&both, &delete_a));
    assert!(failure(&both, &delete_a).is_none());
    assert!(!running(&both, &delete_b));
    assert!(failure(&both, &delete_b).is_some());
    assert!(any_running(&both, &[AdminActionKind::DeleteRole]));
    assert!(!any_running(&both, &[AdminActionKind::ReorderRoles]));
}

// ---- Assignment. ----

#[test]
fn assignment_changes_follow_the_community_order() {
    let order = vec![
        role("a", "A", &[]),
        role("b", "B", &[]),
        role("c", "C", &[]),
        member(),
    ];
    for (held, chosen, add, remove) in [
        (&[][..], &[][..], &[][..], &[][..]),
        (&["r-member"], &["r-member"], &[], &[]),
        (&["r-member"], &["c", "a", "r-member"], &["a", "c"], &[]),
        (&["a", "b"], &["b"], &[], &["a"]),
        (&["a", "b"], &["c"], &["c"], &["a", "b"]),
        // Held roles not in the community's list (just deleted) aren't touched.
        (&["gone"], &[], &[], &[]),
    ] {
        let (got_add, got_remove) = assignment_diff(&order, &set(held), &set(chosen));
        assert_eq!(got_add, strings(add), "{held:?} -> {chosen:?}");
        assert_eq!(got_remove, strings(remove), "{held:?} -> {chosen:?}");
    }
}

// ---- Presets. ----

fn detected(preset: ChannelPreset, posters: &[&str], attach: bool) -> DetectedPreset {
    DetectedPreset {
        preset,
        post_role_ids: strings(posters),
        members_can_attach: attach,
    }
}

#[test]
fn stored_presets_show_as_their_card() {
    for (preset, card) in [
        (ChannelPreset::Normal, Card::Normal),
        (ChannelPreset::ReadOnly, Card::ReadOnly),
        (ChannelPreset::Announcement, Card::Announcement),
        (ChannelPreset::ModsOnly, Card::ModsOnly),
        (ChannelPreset::Custom, Card::Custom),
        (ChannelPreset::Unknown, Card::Custom),
    ] {
        assert_eq!(Card::of(preset), card, "{preset:?}");
    }
    let stored = stored_choice(&detected(ChannelPreset::ReadOnly, &["b", "a", "a"], false));
    assert_eq!(stored.post_role_ids, strings(&["a", "b"]));
}

#[test]
fn custom_shows_only_when_stored_or_chosen() {
    let base = vec![
        Card::Normal,
        Card::ReadOnly,
        Card::Announcement,
        Card::ModsOnly,
    ];
    assert_eq!(cards(Card::Normal, Card::ReadOnly), base);
    let mut with_custom = base.clone();
    with_custom.push(Card::Custom);
    assert_eq!(cards(Card::Custom, Card::Normal), with_custom);
    assert_eq!(cards(Card::Normal, Card::Custom), with_custom);
}

#[test]
fn cards_say_why_they_are_off() {
    for (card, chosen, missing, expected) in [
        (Card::Normal, Card::Normal, &[][..], None),
        (Card::ModsOnly, Card::Normal, &[], Some("Coming soon")),
        (
            Card::Custom,
            Card::Normal,
            &[],
            Some("A custom set comes from the advanced editor"),
        ),
        (Card::Custom, Card::Custom, &[], None),
        (
            Card::ReadOnly,
            Card::Normal,
            &["ATTACH_FILES", "CREATE_REACTION"],
            Some("You need attach files, add reactions to use this"),
        ),
        (
            Card::Announcement,
            Card::Normal,
            &["X_NEW"],
            Some("You need x_new to use this"),
        ),
    ] {
        assert_eq!(
            card_block(card, chosen, &strings(missing)).as_deref(),
            expected,
            "{card:?}"
        );
    }
    let access = vec![PresetAccess {
        preset: ChannelPreset::ReadOnly,
        missing: strings(&["ATTACH_FILES"]),
    }];
    assert_eq!(
        missing_for(&access, Card::ReadOnly),
        strings(&["ATTACH_FILES"])
    );
    assert!(missing_for(&access, Card::Announcement).is_empty());
}

#[test]
fn choosing_and_posting_and_saving() {
    let stored = stored_choice(&detected(ChannelPreset::Normal, &[], true));
    // Picking a read-only kind starts with the default posters.
    let chosen = choose_card(&stored, Card::ReadOnly, &strings(&["mods", "admins"]));
    assert_eq!(chosen.post_role_ids, strings(&["admins", "mods"]));
    assert!(preset_dirty(&chosen, &stored));
    // Posters already picked stay when switching between the read-only kinds.
    let announce = choose_card(&chosen, Card::Announcement, &strings(&["other"]));
    assert_eq!(announce.post_role_ids, chosen.post_role_ids);
    // A chip toggles; twice is back where it was.
    let toggled = toggle_poster(&announce, "zeta");
    assert!(toggled.post_role_ids.contains(&"zeta".to_owned()));
    assert_eq!(toggle_poster(&toggled, "zeta"), announce);
    // Back to what's stored: nothing to save.
    let back = choose_card(&stored, Card::Normal, &[]);
    assert!(!preset_dirty(&back, &stored));
    // Mods only and Custom never save.
    let mut custom = stored.clone();
    custom.card = Card::Custom;
    assert!(!preset_dirty(&custom, &stored));
    // The attach switch alone is a change.
    let mut no_attach = stored.clone();
    no_attach.members_can_attach = false;
    assert!(preset_dirty(&no_attach, &stored));
}

#[test]
fn kept_roles_come_from_core_or_the_stored_allows() {
    let roles = vec![
        OverwriteRoleOption {
            id: "top".into(),
            name: "Top".into(),
            position: 1,
            below_me: false,
        },
        OverwriteRoleOption {
            id: "peer".into(),
            name: "Peer".into(),
            position: 2,
            below_me: false,
        },
        OverwriteRoleOption {
            id: "low".into(),
            name: "Low".into(),
            position: 3,
            below_me: true,
        },
    ];
    let rows = vec![
        OverwriteRow {
            target: OverwriteTarget::Role {
                role_id: "top".into(),
                name: "Top".into(),
            },
            allow: strings(&["CREATE_MESSAGE"]),
            deny: vec![],
            role_missing: false,
        },
        OverwriteRow {
            target: OverwriteTarget::Role {
                role_id: "low".into(),
                name: "Low".into(),
            },
            allow: strings(&["CREATE_MESSAGE"]),
            deny: vec![],
            role_missing: false,
        },
    ];
    let stored = stored_choice(&detected(ChannelPreset::ReadOnly, &["top", "low"], false));
    assert_eq!(
        kept_roles(&roles, &rows, &stored, &stored, None),
        strings(&["top"])
    );
    let changed = toggle_poster(&stored, "low");
    assert!(kept_roles(&roles, &rows, &changed, &stored, None).is_empty());
    let auto = strings(&["peer", "low"]);
    // Core's answer wins, and a role below the user is never locked.
    assert_eq!(
        kept_roles(&roles, &rows, &changed, &stored, Some(&auto)),
        strings(&["peer"])
    );
}

#[test]
fn custom_sets_read_in_plain_words() {
    let rows = vec![
        OverwriteRow {
            target: OverwriteTarget::Everyone,
            allow: vec![],
            deny: strings(&["CREATE_MESSAGE", "ATTACH_FILES"]),
            role_missing: false,
        },
        OverwriteRow {
            target: OverwriteTarget::Role {
                role_id: "m".into(),
                name: "Mods".into(),
            },
            allow: strings(&["CREATE_MESSAGE"]),
            deny: strings(&["SPEAK"]),
            role_missing: false,
        },
        OverwriteRow {
            target: OverwriteTarget::Role {
                role_id: "g".into(),
                name: "g".into(),
            },
            allow: strings(&["X_NEW_THING"]),
            deny: vec![],
            role_missing: true,
        },
    ];
    assert_eq!(
        summarize(&rows),
        strings(&[
            "@everyone: can't send messages, attach files",
            "Mods: can send messages; can't speak in voice",
            "Deleted role: can X_NEW_THING",
        ])
    );
}

#[test]
fn labels_cover_the_catalog_and_fall_back_to_wire_names() {
    assert_eq!(label_of("CREATE_MESSAGE"), "Send messages");
    assert_eq!(label_of("CAPTURE_REPLAY"), "Capture voice replays");
    assert_eq!(label_of("X_NEW"), "X_NEW");
    assert_eq!(group_label("alias_groups"), "Alias Groups");
    assert_eq!(group_label(OTHER_GROUP), "Other");
    assert_eq!(group_label("brand_new"), "Brand new");
    let (shown, more) = actions_preview(&strings(&["SPEAK", "VIDEO", "X", "Y"]), 3);
    assert_eq!(shown, strings(&["Speak in voice", "Use video", "X"]));
    assert_eq!(more, 1);
    assert_eq!(permissions_count(1), "1 permission");
    assert_eq!(permissions_count(0), "0 permissions");
}

// ---- The views. ----

fn roles_view(actions: Vec<AdminActionState>) -> RolesView {
    let mut b = role("b", "Bots", &["SPEAK"]);
    b.can_move_up = true;
    let mut a = role("a", "Hosts", &["SPEAK", "X_UNKNOWN"]);
    a.can_move_down = true;
    RolesView {
        state: LoadState::Ready,
        community_id: "c".into(),
        roles: vec![a, b, member()],
        grantable: strings(&["SPEAK", "VIDEO", "READ_MESSAGE"]),
        can_create: true,
        can_reorder: true,
        can_reset_defaults: true,
        can_read: true,
        op: op(actions),
    }
}

fn catalog() -> Vec<PermissionGroup> {
    vec![PermissionGroup {
        id: "voice".into(),
        actions: strings(&["SPEAK", "VIDEO"]),
    }]
}

fn roles_rig(cx: &mut TestAppContext, view: RolesView) -> Rig<RolesPanel, RolesEvent> {
    rig(cx, 1200., move |window, cx| {
        let mut panel = RolesPanel::new(window, cx);
        panel.set_catalog(catalog(), cx);
        panel.set_roles(view, cx);
        panel
    })
}

#[gpui_kit::test]
fn arrows_reorder_and_delete_asks_first(cx: &mut TestAppContext) {
    let rig = roles_rig(cx, roles_view(vec![]));
    rig.click(cx, "role-up-b");
    rig.click(cx, "role-up-a");
    rig.click(cx, "role-delete-b");
    assert!(rig.has(cx, "role-delete-confirm"));
    rig.click(cx, "role-delete-confirm");
    assert_eq!(
        rig.events(),
        [
            RolesEvent::Reorder {
                role_ids: strings(&["b", "a"])
            },
            RolesEvent::Delete {
                role_id: "b".into()
            },
        ],
        "the top role can't go up"
    );
    assert!(!rig.has(cx, "role-delete-confirm"));
}

#[gpui_kit::test]
fn a_running_delete_shows_on_its_row_only(cx: &mut TestAppContext) {
    let rig = roles_rig(
        cx,
        roles_view(vec![state(
            AdminActionKind::DeleteRole,
            Some("b"),
            true,
            false,
        )]),
    );
    assert!(rig.has(cx, "role-deleting-b"));
    assert!(!rig.has(cx, "role-deleting-a"));
    assert!(rig.has(cx, "role-delete-a"));
    assert!(rig.with(cx, |view, _, cx| view.read(cx).anything_running()));
}

#[gpui_kit::test]
fn the_editor_sends_only_the_changed_actions_and_closes_when_saved(cx: &mut TestAppContext) {
    let rig = roles_rig(cx, roles_view(vec![]));
    rig.with(cx, |view, window, cx| {
        view.update(cx, |panel, cx| {
            panel.open_edit("a", window, cx);
            panel.toggle_action("VIDEO", cx);
            // Not grantable, and unknown: neither changes.
            panel.toggle_action("X_UNKNOWN", cx);
            panel.toggle_action("BAN_USER", cx);
            panel.save(cx);
        })
    });
    assert_eq!(
        rig.events(),
        [RolesEvent::Update {
            role_id: "a".into(),
            patch: RolePatch {
                name: None,
                actions: Some(strings(&["SPEAK", "VIDEO", "X_UNKNOWN"])),
            },
        }]
    );
    let busy = roles_view(vec![state(
        AdminActionKind::UpdateRole,
        Some("a"),
        true,
        false,
    )]);
    rig.with(cx, |view, _, cx| {
        view.update(cx, |p, cx| p.set_roles(busy, cx))
    });
    assert!(rig.has(cx, "role-editor"));
    let mut saved = roles_view(vec![]);
    saved.op = with_ends(
        saved.op,
        &[(AdminActionKind::UpdateRole, Some("a"), 1, false)],
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |p, cx| p.set_roles(saved, cx))
    });
    assert!(!rig.has(cx, "role-editor"), "saved: back to the list");
}

#[gpui_kit::test]
fn a_failed_save_keeps_the_editor_open(cx: &mut TestAppContext) {
    let rig = roles_rig(cx, roles_view(vec![]));
    rig.with(cx, |view, window, cx| {
        view.update(cx, |panel, cx| {
            panel.open_create(window, cx);
            panel.type_name(" Crew ", window, cx);
            panel.toggle_action("SPEAK", cx);
            panel.save(cx);
        })
    });
    assert_eq!(
        rig.events(),
        [RolesEvent::Create {
            draft: RoleDraft {
                name: "Crew".into(),
                actions: strings(&["SPEAK"]),
            }
        }]
    );
    let failed = roles_view(vec![state(AdminActionKind::CreateRole, None, false, true)]);
    rig.with(cx, |view, _, cx| {
        view.update(cx, |p, cx| p.set_roles(failed, cx))
    });
    assert!(rig.has(cx, "role-editor"));
}

#[gpui_kit::test]
fn an_invalid_draft_sends_nothing(cx: &mut TestAppContext) {
    let rig = roles_rig(cx, roles_view(vec![]));
    rig.with(cx, |view, window, cx| {
        view.update(cx, |panel, cx| {
            panel.open_create(window, cx);
            panel.save(cx);
            panel.type_name("Bots", window, cx);
            panel.toggle_action("SPEAK", cx);
            panel.save(cx);
            panel.close_editor(cx);
            panel.open_edit("a", window, cx);
            panel.save(cx);
        })
    });
    assert!(rig.events().is_empty(), "empty, taken, then unchanged");
}

fn assign_rig(
    cx: &mut TestAppContext,
    member_view: MemberRolesView,
) -> Rig<RoleAssignmentDialog, RoleAssignmentEvent> {
    rig(cx, 1200., move |_, cx| {
        let mut dialog = RoleAssignmentDialog::new("u".into(), "una".into());
        dialog.set_roles(roles_view(vec![]), cx);
        dialog.set_member_roles(member_view, cx);
        dialog
    })
}

fn member_view(not_allowed: Option<semaphore_core::model::NotAllowed>) -> MemberRolesView {
    MemberRolesView {
        state: LoadState::Ready,
        user_id: "u".into(),
        held: strings(&["a", "r-member"]),
        changeable: strings(&["a", "b"]),
        not_allowed,
        op: AdminOp::default(),
    }
}

#[gpui_kit::test]
fn the_assignment_dialog_sends_gives_and_takes(cx: &mut TestAppContext) {
    let rig = assign_rig(cx, member_view(None));
    rig.with(cx, |view, _, cx| {
        view.update(cx, |dialog, cx| {
            dialog.toggle("a", cx);
            dialog.toggle("b", cx);
            // Not changeable here.
            dialog.toggle("r-member", cx);
            dialog.save(cx);
            // Saving: a second press sends nothing.
            dialog.save(cx);
        })
    });
    assert_eq!(
        rig.events(),
        [RoleAssignmentEvent::Save {
            user_id: "u".into(),
            add: strings(&["b"]),
            remove: strings(&["a"]),
        }]
    );
}

#[gpui_kit::test]
fn a_member_above_me_changes_nothing(cx: &mut TestAppContext) {
    let rig = assign_rig(
        cx,
        member_view(Some(semaphore_core::model::NotAllowed::Rank)),
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |dialog, cx| {
            dialog.toggle("b", cx);
            dialog.save(cx);
        })
    });
    assert!(rig.events().is_empty());
    assert_eq!(
        rig.with(cx, |view, _, cx| view.read(cx).changes()),
        (vec![], vec![])
    );
}

fn overrides_view(editable: bool, actions: Vec<AdminActionState>) -> ChannelOverwritesView {
    ChannelOverwritesView {
        state: LoadState::Ready,
        channel_id: "ch".into(),
        preset: ChannelPreset::Normal,
        overwrites: vec![],
        editable,
        roles: vec![
            OverwriteRoleOption {
                id: "top".into(),
                name: "Top".into(),
                position: 1,
                below_me: false,
            },
            OverwriteRoleOption {
                id: "mods".into(),
                name: "Mods".into(),
                position: 2,
                below_me: true,
            },
        ],
        detected: detected(ChannelPreset::Normal, &[], true),
        preset_access: vec![PresetAccess {
            preset: ChannelPreset::ReadOnly,
            missing: strings(&["CREATE_REACTION"]),
        }],
        default_post_role_ids: strings(&["mods"]),
        op: op(actions),
    }
}

fn overrides_rig(
    cx: &mut TestAppContext,
    view: ChannelOverwritesView,
) -> Rig<ChannelOverrides, ChannelOverridesEvent> {
    rig(cx, 1200., move |_, cx| {
        let mut editor = ChannelOverrides::new("ch".into());
        editor.set_overwrites(view, cx);
        editor
    })
}

#[gpui_kit::test]
fn presets_preview_then_save_the_choice(cx: &mut TestAppContext) {
    let rig = overrides_rig(cx, overrides_view(true, vec![]));
    rig.click(cx, "preset-read-only");
    rig.click(cx, "preset-mods-only");
    rig.click(cx, "preset-announcement");
    rig.with(cx, |view, _, cx| {
        view.update(cx, |e, cx| e.set_kept(Some(strings(&["top"])), cx))
    });
    assert!(rig.has(cx, "poster-top"), "kept, locked");
    rig.click(cx, "poster-top");
    rig.click(cx, "overrides-save");
    let choice = PresetChoice {
        card: Card::Announcement,
        post_role_ids: strings(&["mods"]),
        members_can_attach: true,
    };
    assert_eq!(
        rig.events(),
        [
            ChannelOverridesEvent::Preview {
                channel_id: "ch".into(),
                choice: choice.clone(),
            },
            ChannelOverridesEvent::Save {
                channel_id: "ch".into(),
                choice,
            },
        ],
        "read-only lacks an action, mods only isn't offered, a locked role isn't pressable"
    );
}

#[gpui_kit::test]
fn without_the_permission_nothing_is_sent(cx: &mut TestAppContext) {
    let rig = overrides_rig(cx, overrides_view(false, vec![]));
    rig.click(cx, "preset-announcement");
    rig.click(cx, "overrides-save");
    assert!(rig.events().is_empty());
    assert!(rig.has(cx, "overrides-locked"));
}

#[gpui_kit::test]
fn a_saved_choice_follows_the_new_stored_set(cx: &mut TestAppContext) {
    let rig = overrides_rig(cx, overrides_view(true, vec![]));
    rig.click(cx, "preset-announcement");
    rig.click(cx, "overrides-save");
    let busy = overrides_view(
        true,
        vec![state(
            AdminActionKind::ReplaceOverwrites,
            Some("ch"),
            true,
            false,
        )],
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |e, cx| e.set_overwrites(busy, cx))
    });
    let mut saved = overrides_view(true, vec![]);
    saved.detected = detected(ChannelPreset::Announcement, &["mods"], false);
    saved.op = with_ends(
        saved.op,
        &[(AdminActionKind::ReplaceOverwrites, Some("ch"), 1, false)],
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |e, cx| e.set_overwrites(saved, cx))
    });
    rig.clear();
    rig.click(cx, "overrides-save");
    assert!(rig.events().is_empty(), "nothing left to save");
}

/// `op` with these ends recorded, as (kind, target, seq, failed).
fn with_ends(mut op: AdminOp, ends: &[(AdminActionKind, Option<&str>, u64, bool)]) -> AdminOp {
    op.finished = ends
        .iter()
        .map(
            |(kind, target, seq, failed)| semaphore_core::model::AdminActionOutcome {
                action: semaphore_core::model::AdminAction {
                    kind: *kind,
                    target_id: target.map(str::to_owned),
                },
                seq: *seq,
                error: failed.then(|| ErrorView {
                    code: "X".into(),
                    message: "failed".into(),
                    retryable: false,
                    retry_after_ms: None,
                }),
            },
        )
        .collect();
    op
}

#[gpui_kit::test]
fn role_dates_are_written_in_the_panels_zone(cx: &mut TestAppContext) {
    use crate::messages::TimeFormat;
    use chrono::FixedOffset;
    let rig = roles_rig(cx, roles_view(vec![]));
    // 2026-11-01 02:00 UTC.
    let ms = 1_793_498_400_000;
    // (minutes east of UTC, the date there)
    let cases = [
        (0, "Nov 1, 2026"),
        (9 * 60, "Nov 1, 2026"),
        (-5 * 60, "Oct 31, 2026"),
        (-(2 * 60 + 30), "Oct 31, 2026"),
        (2 * 60, "Nov 1, 2026"),
    ];
    for (minutes, want) in cases {
        let time = TimeFormat {
            zone: Some(FixedOffset::east_opt(minutes * 60).expect("a zone")),
            now_ms: Some(ms),
        };
        let shown = rig.with(cx, move |view, _, cx| {
            view.update(cx, |panel, cx| {
                panel.set_time(time, cx);
                panel.created_label(ms)
            })
        });
        assert_eq!(shown, want, "{minutes} minutes east");
    }
}
