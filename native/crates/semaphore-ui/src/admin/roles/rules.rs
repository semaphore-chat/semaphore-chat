//! What the instance roles page checks and works out, with no GPUI in it: the role name rules,
//! the editor's draft and the draft a save sends, the matrix's group checkbox, and how a role's
//! actions are counted.
//!
//! Permission rules are core's: this reads its flags (`editable`, `deletable`, `grantable`) and
//! turns its reasons into words.

use semaphore_core::model::{
    InstanceActionGroup, InstanceRoleDraft, InstanceRoleRow, instance_action_groups,
};
use std::collections::BTreeSet;

/// `CreateRoleDto.name`'s 50, counted as core counts it (characters, after trimming).
pub const ROLE_NAME_MAX: usize = 50;

/// What's wrong with a typed role name, in core's words (`commands/instance_admin/roles.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameError {
    Required,
    TooLong,
}

impl NameError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Required => "Role name must not be empty",
            Self::TooLong => "Role name must not exceed 50 characters",
        }
    }
}

/// The name as it is sent: without the spaces around it.
pub fn clean_name(typed: &str) -> &str {
    typed.trim()
}

/// A string's length as core (and `@MaxLength`) counts it: characters.
pub fn name_length(typed: &str) -> usize {
    clean_name(typed).chars().count()
}

/// A typed role name against the server's two rules.
pub fn check_name(typed: &str) -> Result<(), NameError> {
    let name = clean_name(typed);
    if name.is_empty() {
        return Err(NameError::Required);
    }
    if name.chars().count() > ROLE_NAME_MAX {
        return Err(NameError::TooLong);
    }
    Ok(())
}

/// The editor's permission groups, from core (`instance_action_groups()`).
pub fn groups() -> Vec<InstanceActionGroup> {
    instance_action_groups()
}

/// Every action of the editor, in its groups' order: the order a draft sends.
pub fn action_order() -> Vec<String> {
    groups()
        .into_iter()
        .flat_map(|group| group.actions)
        .collect()
}

/// A group checkbox's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tri {
    None,
    Some,
    All,
}

/// The role being made or edited: the typed name and the chosen actions, against what it was.
/// A default role's name never differs: its field is locked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Draft {
    pub original_name: Option<String>,
    pub original_actions: BTreeSet<String>,
    pub name: String,
    pub actions: BTreeSet<String>,
}

impl Draft {
    pub fn create() -> Self {
        Self {
            original_name: None,
            original_actions: BTreeSet::new(),
            name: String::new(),
            actions: BTreeSet::new(),
        }
    }

    pub fn edit(role: &InstanceRoleRow) -> Self {
        let actions: BTreeSet<String> = role.actions.iter().cloned().collect();
        Self {
            original_name: Some(role.name.clone()),
            original_actions: actions.clone(),
            name: role.name.clone(),
            actions,
        }
    }

    pub fn is_new(&self) -> bool {
        self.original_name.is_none()
    }

    /// Turns one action on or off. Only one the user may grant: the others stay as they are.
    pub fn toggle(&mut self, action: &str, grantable: &BTreeSet<String>) {
        if !grantable.contains(action) {
            return;
        }
        if !self.actions.remove(action) {
            self.actions.insert(action.to_owned());
        }
    }

    /// The group's checkbox, counting every action of it that is on (ones the user can't grant
    /// too).
    pub fn group_state(&self, group: &[String]) -> Tri {
        let on = group.iter().filter(|a| self.actions.contains(*a)).count();
        if on == 0 {
            Tri::None
        } else if on == group.len() {
            Tri::All
        } else {
            Tri::Some
        }
    }

    /// The group's checkbox pressed: when every action of it the user may grant is on, those go
    /// off; otherwise they all go on. Actions the user can't grant stay as they are.
    pub fn toggle_group(&mut self, group: &[String], grantable: &BTreeSet<String>) {
        let mine: Vec<&String> = group.iter().filter(|a| grantable.contains(*a)).collect();
        if mine.is_empty() {
            return;
        }
        if mine.iter().all(|a| self.actions.contains(*a)) {
            for action in mine {
                self.actions.remove(action);
            }
        } else {
            for action in mine {
                self.actions.insert(action.clone());
            }
        }
    }

    /// What a save sends: the trimmed name and every action in the editor's order, with the ones
    /// this build doesn't know last (kept, never invented).
    pub fn draft(&self) -> InstanceRoleDraft {
        let order = action_order();
        let mut actions: Vec<String> = order
            .iter()
            .filter(|action| self.actions.contains(*action))
            .cloned()
            .collect();
        actions.extend(
            self.actions
                .iter()
                .filter(|action| !order.contains(action))
                .cloned(),
        );
        InstanceRoleDraft {
            name: clean_name(&self.name).to_owned(),
            actions,
        }
    }

    /// Whether it differs from what it was (a new role always does).
    pub fn is_dirty(&self) -> bool {
        if self.is_new() {
            return true;
        }
        let name = clean_name(&self.name);
        let renamed = self
            .original_name
            .as_deref()
            .is_some_and(|original| original.trim() != name);
        renamed || self.actions != self.original_actions
    }

    /// Why Save is off: the name, or no permission chosen (the server wants one at least).
    pub fn problem(&self) -> Option<String> {
        match check_name(&self.name) {
            Err(error) => Some(error.message().to_owned()),
            Ok(()) if self.actions.is_empty() => {
                Some("Role must have at least one permission".to_owned())
            }
            Ok(()) => None,
        }
    }
}
