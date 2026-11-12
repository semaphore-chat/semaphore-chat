//! W6-E in core, on `FakeBackend` (`common/w6_roles.rs`): the instance roles list, the editor's
//! drafts (checked before they're sent, in the backend's order) and a role's users.

mod common;

use common::w6_roles::*;
use common::*;
use semaphore_core::commands::instance_admin::roles::role_editable;
use semaphore_core::model::{AdminActionKind, InstanceRoleDraft, InstanceRoleRow, LoadState};
use serde_json::{Value, json};

fn draft(name: &str, actions: &[&str]) -> InstanceRoleDraft {
    InstanceRoleDraft {
        name: name.into(),
        actions: actions.iter().map(|action| (*action).to_owned()).collect(),
    }
}

fn ids(rig: &Rig) -> Vec<String> {
    rig.core
        .instance_roles()
        .roles
        .into_iter()
        .map(|role| role.id)
        .collect()
}

/// The server's roles list, and who may change what: an owner.
async fn owner_with(roles: Vec<Value>) -> Rig {
    let rig = Rig::new();
    let mut me = user_json(ME);
    me["role"] = json!("OWNER");
    rig.backend.w3.answer("profile", me);
    rig.backend.w4.answer("w6e_roles", json!(roles));
    rig.signed_in().await
}

/// Signed in as a plain user holding these instance actions, with the server's roles list ready.
async fn member_with(actions: &[&str], roles: Vec<Value>) -> Rig {
    let rig = Rig::new();
    rig.backend.w3.answer(
        "instance_roles",
        my_roles_json(vec![role_json("r1", "Helper", 1, actions)]),
    );
    rig.backend.w4.answer("w6e_roles", json!(roles));
    let rig = rig.signed_in().await;
    rig.core.instance_permissions();
    rig.core.run_until_idle().await;
    rig
}

fn names(rig: &Rig) -> Vec<String> {
    rig.core
        .instance_roles()
        .roles
        .into_iter()
        .map(|role| role.name)
        .collect()
}

// ----- what may be changed ---------------------------------------------------------------------

#[test]
fn role_editable_table() {
    let held = |actions: &[&str]| -> Vec<String> {
        actions.iter().map(|action| (*action).to_owned()).collect()
    };
    let role = |actions: &[&str]| -> Vec<String> {
        actions.iter().map(|action| (*action).to_owned()).collect()
    };
    // Full authority may change any role, whatever it holds.
    assert!(role_editable(
        true,
        &[],
        &role(&["READ_USER", "DELETE_USER"])
    ));
    // Holding all of its actions may.
    assert!(role_editable(
        false,
        &held(&["READ_USER", "DELETE_USER", "READ_INSTANCE_STATS"]),
        &role(&["READ_USER", "DELETE_USER"])
    ));
    // Holding all but one may not.
    assert!(!role_editable(
        false,
        &held(&["READ_USER"]),
        &role(&["READ_USER", "DELETE_USER"])
    ));
    // A role with no actions needs nothing.
    assert!(role_editable(false, &[], &role(&[])));
    // An action this build doesn't know is one I must hold too.
    assert!(!role_editable(
        false,
        &held(&["READ_USER"]),
        &role(&["SOMETHING_NEW"])
    ));
    assert!(role_editable(
        false,
        &held(&["READ_USER", "SOMETHING_NEW"]),
        &role(&["READ_USER", "SOMETHING_NEW"])
    ));
}

// ----- the list --------------------------------------------------------------------------------

#[tokio::test]
async fn the_list_maps_and_sorts_roles_and_says_what_is_grantable() {
    // The owner: every role editable, all 12 actions grantable.
    let mut rig = owner_with(vec![
        role_json(OTHER_ROLE, "Helpers", 30, &["READ_USER"]),
        admin_role_json(),
        role_json(CUSTOM_ROLE, "Builders", 20, &["READ_USER", "UPDATE_USER"]),
    ])
    .await;
    assert_eq!(rig.core.instance_roles().state, LoadState::Loading);
    rig.settle().await;
    let view = rig.core.instance_roles();
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(
        view.roles
            .iter()
            .map(|role| role.name.as_str())
            .collect::<Vec<_>>(),
        ["Instance Admin", "Builders", "Helpers"],
        "by position"
    );
    assert_eq!(
        view.roles[1],
        InstanceRoleRow {
            id: CUSTOM_ROLE.into(),
            name: "Builders".into(),
            actions: vec!["READ_USER".into(), "UPDATE_USER".into()],
            is_default: false,
            position: 20,
            editable: true,
            deletable: true,
        }
    );
    assert!(view.roles.iter().all(|role| role.editable));
    assert!(
        view.roles[0].is_default && !view.roles[0].deletable,
        "the Instance Admin role is never deletable"
    );
    assert_eq!(
        view.grantable,
        [
            "READ_INSTANCE_SETTINGS",
            "UPDATE_INSTANCE_SETTINGS",
            "READ_INSTANCE_STATS",
            "MANAGE_USER_STORAGE",
            "READ_USER",
            "UPDATE_USER",
            "BAN_USER",
            "DELETE_USER",
            "READ_INSTANCE_INVITE",
            "CREATE_INSTANCE_INVITE",
            "DELETE_INSTANCE_INVITE",
            "UPDATE_INSTANCE_INVITE",
        ]
    );

    // A plain user holding two actions: only the roles whose actions they all hold, and only
    // those two actions to grant, in the admin list's order.
    let rig = member_with(
        &["READ_USER", "READ_INSTANCE_SETTINGS"],
        vec![
            role_json(OTHER_ROLE, "Both", 30, &["READ_USER", "UPDATE_USER"]),
            role_json(CUSTOM_ROLE, "Mine", 20, &["READ_USER"]),
        ],
    )
    .await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    let view = rig.core.instance_roles();
    assert_eq!(
        view.roles
            .iter()
            .map(|role| (role.name.as_str(), role.editable, role.deletable))
            .collect::<Vec<_>>(),
        [("Mine", true, true), ("Both", false, false)]
    );
    assert_eq!(
        view.grantable,
        ["READ_INSTANCE_SETTINGS", "READ_USER"],
        "in the admin list's order"
    );

    // My instance roles not read yet: nothing is editable and nothing may be granted.
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "w6e_roles",
        json!([role_json(CUSTOM_ROLE, "Mine", 20, &[])]),
    );
    rig.core.instance_roles();
    rig.settle().await;
    let view = rig.core.instance_roles();
    assert_eq!(view.roles.len(), 1);
    assert!(!view.roles[0].editable && !view.roles[0].deletable);
    assert!(view.grantable.is_empty());
}

#[tokio::test]
async fn a_roles_users_are_read_and_mapped() {
    let mut rig = owner_with(vec![admin_role_json()]).await;
    rig.core.instance_roles();
    rig.settle().await;
    rig.backend
        .w4
        .answer("w6e_role_users", json!([role_user_json(ME, "mike")]));
    let view = rig.core.instance_role_users(ADMIN_ROLE.into());
    assert_eq!(view.state, LoadState::Loading);
    assert_eq!(view.role_id, ADMIN_ROLE);
    rig.settle().await;
    let view = rig.core.instance_role_users(ADMIN_ROLE.into());
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(
        view.users
            .iter()
            .map(|user| (user.id.as_str(), user.username.as_str()))
            .collect::<Vec<_>>(),
        [(ME, "mike")]
    );
    assert!(view.users[0].display_name.is_none());
    assert!(view.users[0].avatar_file_id.is_none());
    assert_eq!(rig.backend.w4.count("w6e_role_users"), 1, "fresh for 30 s");
}

// ----- drafting --------------------------------------------------------------------------------

#[tokio::test]
async fn validation_table() {
    let fifty = "n".repeat(50);
    let long = "n".repeat(51);

    // Creates, refused before anything is sent.
    let mut rig = owner_with(vec![
        admin_role_json(),
        role_json(CUSTOM_ROLE, "Helpers", 30, &["READ_USER"]),
    ])
    .await;
    rig.core.instance_roles();
    rig.settle().await;
    let rows: Vec<(InstanceRoleDraft, &str)> = vec![
        (draft("", &["READ_USER"]), "Role name must not be empty"),
        (draft("   ", &["READ_USER"]), "Role name must not be empty"),
        (
            draft(&long, &["READ_USER"]),
            "Role name must not exceed 50 characters",
        ),
        (
            draft("Empty", &[]),
            "Role must have at least one permission",
        ),
        (
            draft("Chatty", &["DELETE_MESSAGE"]),
            "Actions not valid for instance roles: DELETE_MESSAGE",
        ),
        (
            draft("Mixed", &["READ_USER", "DELETE_MESSAGE", "SPEAK"]),
            "Actions not valid for instance roles: DELETE_MESSAGE, SPEAK",
        ),
    ];
    for (draft, message) in rows {
        let error = rig.core.create_instance_role(draft).await.unwrap_err();
        match error {
            semaphore_core::platform::CoreError::Failed { message: got } => {
                assert_eq!(got, message);
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
        let op = rig.core.instance_roles().op;
        assert!(!op.busy);
        assert_eq!(op.error.expect("the refusal shows").message, message);
    }
    assert_eq!(rig.backend.w4.count("w6e_create_role"), 0, "nothing sent");

    // A valid create sends the trimmed name and the actions, and lands.
    rig.backend.w4.answer(
        "w6e_create_role",
        role_json(CUSTOM_ROLE, "Builders", 40, &["READ_USER"]),
    );
    let id = rig
        .core
        .create_instance_role(draft(&fifty, &["READ_USER"]))
        .await
        .unwrap();
    assert_eq!(id, CUSTOM_ROLE);
    let call = rig.backend.w4.calls();
    let call = call
        .iter()
        .find(|call| call.starts_with("w6e_create_role"))
        .unwrap();
    assert_eq!(
        call,
        &format!("w6e_create_role {{\"actions\":[\"READ_USER\"],\"name\":\"{fifty}\"}}")
    );

    // A plain user may only grant what they hold.
    let rig = member_with(
        &["READ_USER"],
        vec![role_json(CUSTOM_ROLE, "Helpers", 30, &["READ_USER"])],
    )
    .await;
    let error = rig
        .core
        .create_instance_role(draft("Helpers", &["READ_USER", "UPDATE_USER"]))
        .await
        .unwrap_err();
    match error {
        semaphore_core::platform::CoreError::Failed { message } => {
            assert_eq!(
                message,
                "Cannot grant permissions you do not have: UPDATE_USER"
            );
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(rig.backend.w4.count("w6e_create_role"), 0, "nothing sent");

    // Updates, refused before anything is sent.
    let mut rig = owner_with(vec![
        admin_role_json(),
        role_json(CUSTOM_ROLE, "Helpers", 30, &["READ_USER"]),
    ])
    .await;
    rig.core.instance_roles();
    rig.settle().await;
    let error = rig
        .core
        .update_instance_role(ADMIN_ROLE.into(), draft("Renamed", &["READ_USER"]))
        .await
        .unwrap_err();
    match error {
        semaphore_core::platform::CoreError::Failed { message } => {
            assert_eq!(message, "Cannot rename a default role");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    let error = rig
        .core
        .update_instance_role(CUSTOM_ROLE.into(), draft("Helpers", &[]))
        .await
        .unwrap_err();
    match error {
        semaphore_core::platform::CoreError::Failed { message } => {
            assert_eq!(message, "Role must have at least one permission");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(rig.backend.w4.count("w6e_update_role"), 0, "nothing sent");

    // A valid update sends the trimmed name and the whole action list.
    rig.backend.w4.answer(
        "w6e_update_role",
        role_json(CUSTOM_ROLE, "Builders", 30, &["READ_USER", "UPDATE_USER"]),
    );
    rig.core
        .update_instance_role(
            CUSTOM_ROLE.into(),
            draft(" Builders ", &["READ_USER", "UPDATE_USER"]),
        )
        .await
        .unwrap();
    let call = rig.backend.w4.calls();
    let call = call
        .iter()
        .find(|call| call.starts_with("w6e_update_role"))
        .unwrap();
    assert_eq!(
        call,
        &format!(
            "w6e_update_role {CUSTOM_ROLE} {{\"actions\":[\"READ_USER\",\"UPDATE_USER\"],\"name\":\"Builders\"}}"
        )
    );

    // A plain user may not change a role whose actions they don't all hold, even to one they do.
    let rig = member_with(
        &["READ_USER"],
        vec![role_json(
            CUSTOM_ROLE,
            "Both",
            30,
            &["READ_USER", "UPDATE_USER"],
        )],
    )
    .await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    let error = rig
        .core
        .update_instance_role(CUSTOM_ROLE.into(), draft("Both", &["READ_USER"]))
        .await
        .unwrap_err();
    match error {
        semaphore_core::platform::CoreError::Failed { message } => {
            assert_eq!(
                message,
                "Cannot grant permissions you do not have: UPDATE_USER"
            );
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(rig.backend.w4.count("w6e_update_role"), 0, "nothing sent");
}

// ----- changes ---------------------------------------------------------------------------------

#[tokio::test]
async fn create_appends_and_update_replaces() {
    let mut rig = owner_with(vec![admin_role_json()]).await;
    rig.core.instance_roles();
    rig.settle().await;

    rig.backend.w4.answer(
        "w6e_create_role",
        role_json(OTHER_ROLE, "Builders", 40, &["READ_USER"]),
    );
    let id = rig
        .core
        .create_instance_role(draft("Builders", &["READ_USER"]))
        .await
        .unwrap();
    assert_eq!(id, OTHER_ROLE);
    assert_eq!(ids(&rig), [ADMIN_ROLE, OTHER_ROLE], "appended");
    assert!(!rig.core.instance_roles().op.busy);

    rig.backend.w4.answer(
        "w6e_update_role",
        role_json(OTHER_ROLE, "Deployers", 40, &["READ_USER", "UPDATE_USER"]),
    );
    rig.core
        .update_instance_role(
            OTHER_ROLE.into(),
            draft("Deployers", &["READ_USER", "UPDATE_USER"]),
        )
        .await
        .unwrap();
    let roles = rig.core.instance_roles().roles;
    assert_eq!(ids(&rig), [ADMIN_ROLE, OTHER_ROLE], "replaced in place");
    assert_eq!(roles[1].name, "Deployers");
    assert_eq!(roles[1].actions, ["READ_USER", "UPDATE_USER"]);
    let op = rig.core.instance_roles().op;
    assert_eq!(
        op.finished.last().unwrap().action.kind,
        AdminActionKind::UpdateInstanceRole
    );
    assert_eq!(
        op.finished.last().unwrap().action.target_id.as_deref(),
        Some(OTHER_ROLE)
    );
}

#[tokio::test]
async fn delete_goes_at_once_and_comes_back_when_refused() {
    let rig = owner_with(vec![
        admin_role_json(),
        role_json(CUSTOM_ROLE, "Builders", 20, &["READ_USER"]),
        role_json(OTHER_ROLE, "Helpers", 30, &["READ_USER"]),
    ])
    .await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    assert_eq!(ids(&rig), [ADMIN_ROLE, CUSTOM_ROLE, OTHER_ROLE]);

    let hold = rig.backend.w4.hold("w6e_delete_role");
    rig.backend
        .w4
        .fail_next("w6e_delete_role", refusal(403, "FORBIDDEN"));
    let deleting = rig.core.delete_instance_role(CUSTOM_ROLE.into());
    let (result, ()) = tokio::join!(deleting, async {
        tokio::task::yield_now().await;
        assert_eq!(ids(&rig), [ADMIN_ROLE, OTHER_ROLE], "gone at once");
        hold.send(()).unwrap();
    });
    assert!(result.is_err());
    assert_eq!(
        ids(&rig),
        [ADMIN_ROLE, CUSTOM_ROLE, OTHER_ROLE],
        "back where it was"
    );
    let op = rig.core.instance_roles().op;
    assert!(!op.busy);
    assert_eq!(
        op.error.expect("the refusal shows").message,
        "refused: FORBIDDEN"
    );

    // Accepted: it stays gone.
    rig.core
        .delete_instance_role(CUSTOM_ROLE.into())
        .await
        .unwrap();
    assert_eq!(ids(&rig), [ADMIN_ROLE, OTHER_ROLE]);
    assert_eq!(
        rig.backend.w4.calls().last().unwrap(),
        &format!("w6e_delete_role {CUSTOM_ROLE}")
    );
}

#[tokio::test]
async fn the_instance_admin_role_is_not_deletable() {
    let rig = owner_with(vec![admin_role_json()]).await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    let error = rig
        .core
        .delete_instance_role(ADMIN_ROLE.into())
        .await
        .unwrap_err();
    match error {
        semaphore_core::platform::CoreError::Failed { message } => {
            assert_eq!(message, "Cannot delete the default Instance Admin role");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert_eq!(ids(&rig), [ADMIN_ROLE], "still there");
    assert_eq!(rig.backend.w4.count("w6e_delete_role"), 0, "nothing sent");
    let op = rig.core.instance_roles().op;
    assert_eq!(
        op.error.expect("the refusal shows").message,
        "Cannot delete the default Instance Admin role"
    );
}

#[tokio::test]
async fn a_refused_create_shows_the_servers_message() {
    let rig = owner_with(vec![admin_role_json()]).await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    rig.backend
        .w4
        .fail_next("w6e_create_role", refusal(409, "CONFLICT"));
    assert!(
        rig.core
            .create_instance_role(draft("Builders", &["READ_USER"]))
            .await
            .is_err()
    );
    assert_eq!(ids(&rig), [ADMIN_ROLE], "nothing was appended");
    let op = rig.core.instance_roles().op;
    assert!(!op.busy);
    assert_eq!(
        op.error.expect("the refusal shows").message,
        "refused: CONFLICT"
    );
}

#[tokio::test]
async fn an_answer_after_sign_out_changes_nothing() {
    let rig = owner_with(vec![admin_role_json()]).await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;

    let hold = rig.backend.w4.hold("w6e_create_role");
    rig.backend.w4.answer(
        "w6e_create_role",
        role_json(OTHER_ROLE, "Builders", 40, &["READ_USER"]),
    );
    let core = rig.core.clone();
    let creating = tokio::spawn(async move {
        core.create_instance_role(draft("Builders", &["READ_USER"]))
            .await
    });
    tokio::task::yield_now().await;
    rig.core.sign_out().await.unwrap();
    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    hold.send(()).unwrap();
    assert!(
        creating.await.unwrap().is_err(),
        "an ended session's answer"
    );
    assert!(
        !names(&rig).contains(&"Builders".to_owned()),
        "nothing landed"
    );
}

#[tokio::test]
async fn a_new_connection_reads_the_roles_again() {
    let rig = owner_with(vec![admin_role_json()]).await;
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w6e_roles"), 1);
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.core.instance_roles();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w4.count("w6e_roles"), 2);
}
