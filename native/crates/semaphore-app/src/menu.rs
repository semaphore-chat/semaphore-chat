//! The application menu, and the actions behind it: Electron's `setupApplicationMenu`
//! (`frontend/electron/main.ts`), as far as a native window has a use for it.
//!
//! - **What is in it.** File (non-macOS) or the app menu (macOS): Close Window, a checked Close to
//!   Tray, Quit. Edit: undo, redo, cut, copy, paste, select all, which are the text inputs' and the
//!   message list's own actions. View: toggle full screen. Help: About Semaphore Chat and Check
//!   for Updates, which runs the same check as the settings button (and is disabled exactly when
//!   that button is). Every label and item is in [`FILE_MENU`] and the tables beside it, so a test
//!   can compare the built tree.
//! - **What is left out, and why.** Reload, force reload and the developer tools drive the
//!   webview this app doesn't have. Zoom needs a UI scale, and the kit draws in px (a window-level
//!   rem scale would change nothing without kit changes), so Electron's zoom roles have no
//!   counterpart yet. macOS's hide, hide others and unhide are menu roles GPUI has no item for.
//! - **Where it is drawn.** `cx.set_menus` hands the tree to platforms with a native menu bar
//!   (macOS). The pinned GPUI's Linux (X11 and Wayland) and Windows platforms copy it into
//!   `OwnedMenu`s and never show it, so this file is not the only way to an action: on those
//!   platforms Quit, Close Window and Toggle Full Screen keep their key bindings, About is also in
//!   the account menu (the rail's user menu), and Close to Tray is in the settings screen and the
//!   tray menu.
//! - **Bindings.** Only the three actions whose keys the app didn't already have are bound
//!   globally. The edit actions keep their existing bindings (the text inputs', in their own key
//!   context; the message list's, for selection), because a context-free binding would outrank
//!   them. [`BINDINGS`] is checked against every binding the app already has.

use crate::desktop::DesktopShell;
use crate::root::AppRoot;
use gpui_kit::*;
use std::path::PathBuf;

actions!(
    semaphore,
    [
        Quit,
        CloseWindow,
        ToggleFullScreen,
        ToggleCloseToTray,
        About,
        CheckForUpdates
    ]
);

/// The name the menu bar shows and About says.
pub const APP_NAME: &str = "Semaphore Chat";

/// CmdOrCtrl+Q, as Electron's Quit.
pub const QUIT_KEYS: &str = if cfg!(target_os = "macos") {
    "cmd-q"
} else {
    "ctrl-q"
};
/// CmdOrCtrl+W: Electron has no Close item (the macOS Window menu supplies one), but on Linux and
/// Windows the menu bar isn't drawn, so the action needs a key. CmdOrCtrl+W is what a macOS close
/// and a browser use.
pub const CLOSE_KEYS: &str = if cfg!(target_os = "macos") {
    "cmd-w"
} else {
    "ctrl-w"
};
/// F11, Electron's `togglefullscreen` accelerator on Linux and Windows (Ctrl+Cmd+F on macOS).
pub const FULLSCREEN_KEYS: &str = if cfg!(target_os = "macos") {
    "ctrl-cmd-f"
} else {
    "f11"
};

/// The global bindings this file adds, and what each does.
pub const BINDINGS: &[(&str, &str)] = &[
    (QUIT_KEYS, "Quit"),
    (CLOSE_KEYS, "Close Window"),
    (FULLSCREEN_KEYS, "Toggle Full Screen"),
];

/// Every action this file handles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuAction {
    Quit,
    CloseWindow,
    CloseToTray,
    ToggleFullScreen,
    About,
    CheckForUpdates,
}

impl MenuAction {
    /// Every action the menu offers, in the order the tables below use them.
    pub const ALL: [MenuAction; 6] = [
        MenuAction::Quit,
        MenuAction::CloseWindow,
        MenuAction::CloseToTray,
        MenuAction::ToggleFullScreen,
        MenuAction::About,
        MenuAction::CheckForUpdates,
    ];

    pub const fn label(self) -> &'static str {
        match self {
            MenuAction::Quit => "Quit",
            MenuAction::CloseWindow => "Close Window",
            MenuAction::CloseToTray => "Close to Tray",
            MenuAction::ToggleFullScreen => "Toggle Full Screen",
            MenuAction::About => "About Semaphore Chat",
            MenuAction::CheckForUpdates => "Check for Updates",
        }
    }

    fn item(self, close_to_tray: bool, updates_enabled: bool) -> MenuItem {
        let item = match self {
            MenuAction::Quit => MenuItem::action(self.label(), Quit),
            MenuAction::CloseWindow => MenuItem::action(self.label(), CloseWindow),
            MenuAction::CloseToTray => MenuItem::action(self.label(), ToggleCloseToTray),
            MenuAction::ToggleFullScreen => MenuItem::action(self.label(), ToggleFullScreen),
            MenuAction::About => MenuItem::action(self.label(), About),
            MenuAction::CheckForUpdates => MenuItem::action(self.label(), CheckForUpdates),
        };
        item.disabled(self == MenuAction::CheckForUpdates && !updates_enabled)
            .checked(self == MenuAction::CloseToTray && close_to_tray)
    }

    /// What choosing the item (or pressing its key) does. The match is exhaustive, so a new action
    /// can't be added to the menu without a handler.
    fn run(self, cx: &mut App) {
        match self {
            MenuAction::Quit => cx.quit(),
            MenuAction::CloseWindow => DesktopShell::close_window(cx),
            MenuAction::CloseToTray => toggle_close_to_tray(cx),
            MenuAction::ToggleFullScreen => toggle_full_screen(cx),
            MenuAction::About => open_about(cx),
            MenuAction::CheckForUpdates => check_for_updates(cx),
        }
    }
}

/// The Edit menu's actions: gpui-base's text-input actions, which the focused input (and, for
/// copy and select all, the message list) already answers through its own key bindings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditAction {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
}

impl EditAction {
    pub const ALL: [EditAction; 6] = [
        EditAction::Undo,
        EditAction::Redo,
        EditAction::Cut,
        EditAction::Copy,
        EditAction::Paste,
        EditAction::SelectAll,
    ];

    pub const fn label(self) -> &'static str {
        match self {
            EditAction::Undo => "Undo",
            EditAction::Redo => "Redo",
            EditAction::Cut => "Cut",
            EditAction::Copy => "Copy",
            EditAction::Paste => "Paste",
            EditAction::SelectAll => "Select All",
        }
    }

    fn item(self) -> MenuItem {
        match self {
            EditAction::Undo => MenuItem::action(self.label(), base::input::Undo),
            EditAction::Redo => MenuItem::action(self.label(), base::input::Redo),
            EditAction::Cut => MenuItem::action(self.label(), base::input::Cut),
            EditAction::Copy => MenuItem::action(self.label(), base::input::Copy),
            EditAction::Paste => MenuItem::action(self.label(), base::input::Paste),
            EditAction::SelectAll => MenuItem::action(self.label(), base::input::SelectAll),
        }
    }
}

/// One item of a menu: a separator, one of ours, or one of the inputs' edit actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemSpec {
    pub label: &'static str,
    pub kind: ItemKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Separator,
    Menu(MenuAction),
    Edit(EditAction),
}

impl ItemSpec {
    const fn separator() -> Self {
        Self {
            label: "",
            kind: ItemKind::Separator,
        }
    }

    const fn own(action: MenuAction) -> Self {
        Self {
            label: action.label(),
            kind: ItemKind::Menu(action),
        }
    }

    const fn edit(action: EditAction) -> Self {
        Self {
            label: action.label(),
            kind: ItemKind::Edit(action),
        }
    }

    fn build(self, close_to_tray: bool, updates_enabled: bool) -> MenuItem {
        match self.kind {
            ItemKind::Separator => MenuItem::separator(),
            ItemKind::Menu(action) => action.item(close_to_tray, updates_enabled),
            ItemKind::Edit(action) => action.item(),
        }
    }
}

/// One menu of the bar.
#[derive(Debug)]
pub struct MenuSpec {
    pub label: &'static str,
    pub items: &'static [ItemSpec],
}

/// File, on Linux and Windows (Electron's non-macOS File menu, plus Close Window).
pub const FILE_MENU: MenuSpec = MenuSpec {
    label: "File",
    items: &[
        ItemSpec::own(MenuAction::CloseWindow),
        ItemSpec::own(MenuAction::CloseToTray),
        ItemSpec::separator(),
        ItemSpec::own(MenuAction::Quit),
    ],
};

/// The app menu macOS puts before File; Electron's app menu has hide, hide others and unhide
/// between About and Close to Tray, which GPUI has no menu item for.
pub const APP_MENU: MenuSpec = MenuSpec {
    label: APP_NAME,
    items: &[
        ItemSpec::own(MenuAction::About),
        ItemSpec::separator(),
        ItemSpec::own(MenuAction::CloseToTray),
        ItemSpec::separator(),
        ItemSpec::own(MenuAction::Quit),
    ],
};

pub const EDIT_MENU: MenuSpec = MenuSpec {
    label: "Edit",
    items: &[
        ItemSpec::edit(EditAction::Undo),
        ItemSpec::edit(EditAction::Redo),
        ItemSpec::separator(),
        ItemSpec::edit(EditAction::Cut),
        ItemSpec::edit(EditAction::Copy),
        ItemSpec::edit(EditAction::Paste),
        ItemSpec::edit(EditAction::SelectAll),
    ],
};

pub const VIEW_MENU: MenuSpec = MenuSpec {
    label: "View",
    items: &[ItemSpec::own(MenuAction::ToggleFullScreen)],
};

pub const HELP_MENU: MenuSpec = MenuSpec {
    label: "Help",
    items: &[
        ItemSpec::own(MenuAction::About),
        ItemSpec::own(MenuAction::CheckForUpdates),
    ],
};

/// The bar on Linux and Windows.
pub const DESKTOP_MENUS: &[&MenuSpec] = &[&FILE_MENU, &EDIT_MENU, &VIEW_MENU, &HELP_MENU];
/// The bar on macOS: the app menu, then Edit, View and Help (Electron has no File menu there).
pub const MAC_MENUS: &[&MenuSpec] = &[&APP_MENU, &EDIT_MENU, &VIEW_MENU, &HELP_MENU];

/// The menu bar for this platform, with the Close to Tray check box where the settings say it is
/// and Check for Updates enabled where the settings button is.
pub fn menus(close_to_tray: bool, updates_enabled: bool, mac: bool) -> Vec<Menu> {
    let specs = if mac { MAC_MENUS } else { DESKTOP_MENUS };
    specs
        .iter()
        .map(|menu| {
            Menu::new(menu.label).items(
                menu.items
                    .iter()
                    .map(|item| item.build(close_to_tray, updates_enabled))
                    .collect::<Vec<_>>(),
            )
        })
        .collect()
}

/// Hands the bar to the platform. Call it when the app starts, whenever the Close to Tray setting
/// changes (the item is checked) and whenever the updater's availability changes.
pub fn install(cx: &mut App, close_to_tray: bool, updates_enabled: bool) {
    cx.set_menus(menus(
        close_to_tray,
        updates_enabled,
        cfg!(target_os = "macos"),
    ));
}

/// Registers the key bindings and handlers, once per process, before the first window.
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new(QUIT_KEYS, Quit, None),
        KeyBinding::new(CLOSE_KEYS, CloseWindow, None),
        KeyBinding::new(FULLSCREEN_KEYS, ToggleFullScreen, None),
    ]);
    cx.on_action(|_: &Quit, cx| MenuAction::Quit.run(cx));
    cx.on_action(|_: &CloseWindow, cx| MenuAction::CloseWindow.run(cx));
    cx.on_action(|_: &ToggleFullScreen, cx| MenuAction::ToggleFullScreen.run(cx));
    cx.on_action(|_: &ToggleCloseToTray, cx| MenuAction::CloseToTray.run(cx));
    cx.on_action(|_: &About, cx| MenuAction::About.run(cx));
    cx.on_action(|_: &CheckForUpdates, cx| MenuAction::CheckForUpdates.run(cx));
}

/// The window's root the menu actions act on: the app has one window.
struct MenuTarget(WeakEntity<AppRoot>);

impl Global for MenuTarget {}

/// This root is the one the menu actions are for. Called from `AppRoot::new`.
pub(crate) fn target(cx: &mut Context<AppRoot>) {
    cx.set_global(MenuTarget(cx.entity().downgrade()));
}

fn target_root(cx: &mut App) -> Option<WeakEntity<AppRoot>> {
    cx.try_global::<MenuTarget>().map(|target| target.0.clone())
}

/// Flips the Close to Tray setting: the same change the settings screen and the tray's check box
/// make (`AppRoot::set_close_to_tray`), then a fresh bar so the item's check mark matches.
fn toggle_close_to_tray(cx: &mut App) {
    let Some(root) = target_root(cx) else {
        return;
    };
    let next = root
        .read_with(cx, |root, _| !root.settings().close_to_tray)
        .unwrap_or(false);
    root.update(cx, |root, cx| root.set_close_to_tray(next, cx))
        .ok();
}

/// The settings' "Check for updates", from a menu item or the tray: the same command.
fn check_for_updates(cx: &mut App) {
    let Some(root) = target_root(cx) else {
        return;
    };
    root.update(cx, |root, cx| root.check_for_updates(cx)).ok();
}

fn toggle_full_screen(cx: &mut App) {
    if let Some(window) = cx.active_window() {
        window
            .update(cx, |_, window, _| window.toggle_fullscreen())
            .ok();
    }
}

/// About Semaphore Chat, over whatever is on screen. A keystroke's action arrives without the
/// window, so it's taken for the length of one update.
fn open_about(cx: &mut App) {
    let Some(root) = target_root(cx) else {
        return;
    };
    let Some(window) = cx.active_window() else {
        return;
    };
    window
        .update(cx, |_, window, cx| {
            root.update(cx, |root, cx| root.open_about(window, cx)).ok();
        })
        .ok();
}

/// Where the package put the third-party licences (`docs/packaging.md`): the Linux package's doc
/// directory, or a file beside the executable (the portable Windows zip, a checkout build). `None`
/// when this build installed none, and the About dialog then offers no licence link.
pub fn licences_path() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(
        "/usr/share/doc/semaphore-chat-native/THIRD-PARTY-LICENCES.txt",
    )];
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join("THIRD-PARTY-LICENCES.txt"));
        candidates.push(dir.join("LICENSE.md"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// One item of the built bar, ready to compare: the label and the action's full name (None for
    /// a separator), whether it is checked, and whether it is disabled.
    type Built = (String, Option<&'static str>, bool, bool);

    fn built(close_to_tray: bool, updates_enabled: bool, mac: bool) -> Vec<(String, Vec<Built>)> {
        menus(close_to_tray, updates_enabled, mac)
            .into_iter()
            .map(|menu| {
                let items = menu
                    .items
                    .into_iter()
                    .map(|item| match item {
                        MenuItem::Separator => (String::new(), None, false, false),
                        MenuItem::Action {
                            name,
                            action,
                            checked,
                            disabled,
                            ..
                        } => (name.to_string(), Some(action.name()), checked, disabled),
                        MenuItem::Submenu(menu) => (menu.name.to_string(), None, false, false),
                        MenuItem::SystemMenu(menu) => (menu.name.to_string(), None, false, false),
                    })
                    .collect();
                (menu.name.to_string(), items)
            })
            .collect()
    }

    fn item(label: &str, action: &'static str) -> Built {
        (label.to_owned(), Some(action), false, false)
    }

    fn disabled_item(label: &str, action: &'static str) -> Built {
        (label.to_owned(), Some(action), false, true)
    }

    fn separator() -> Built {
        (String::new(), None, false, false)
    }

    /// The bar on Linux and Windows: Electron's File (with Close Window), Edit, View and Help,
    /// with the items Electron has that a native window can act on.
    #[test]
    fn the_desktop_bar_matches_the_table() {
        assert_eq!(
            built(false, true, false),
            [
                (
                    "File".to_owned(),
                    vec![
                        item("Close Window", "semaphore::CloseWindow"),
                        item("Close to Tray", "semaphore::ToggleCloseToTray"),
                        separator(),
                        item("Quit", "semaphore::Quit"),
                    ]
                ),
                (
                    "Edit".to_owned(),
                    vec![
                        item("Undo", "input::Undo"),
                        item("Redo", "input::Redo"),
                        separator(),
                        item("Cut", "input::Cut"),
                        item("Copy", "input::Copy"),
                        item("Paste", "input::Paste"),
                        item("Select All", "input::SelectAll"),
                    ]
                ),
                (
                    "View".to_owned(),
                    vec![item("Toggle Full Screen", "semaphore::ToggleFullScreen")]
                ),
                (
                    "Help".to_owned(),
                    vec![
                        item("About Semaphore Chat", "semaphore::About"),
                        item("Check for Updates", "semaphore::CheckForUpdates"),
                    ]
                ),
            ]
        );
    }

    /// macOS gets the app menu from Electron's template first (minus hide/hide others/unhide,
    /// which GPUI has no roles for), and no File menu.
    #[test]
    fn the_mac_bar_matches_the_table() {
        let bar = built(false, true, true);
        assert_eq!(bar[0].0, "Semaphore Chat");
        assert_eq!(
            bar[0].1,
            [
                item("About Semaphore Chat", "semaphore::About"),
                separator(),
                item("Close to Tray", "semaphore::ToggleCloseToTray"),
                separator(),
                item("Quit", "semaphore::Quit"),
            ]
        );
        let labels: Vec<&str> = bar.iter().map(|(label, _)| label.as_str()).collect();
        assert_eq!(labels, ["Semaphore Chat", "Edit", "View", "Help"]);
        let help = bar.last().expect("a Help menu");
        assert_eq!(
            help.1,
            [
                item("About Semaphore Chat", "semaphore::About"),
                item("Check for Updates", "semaphore::CheckForUpdates"),
            ]
        );
    }

    /// Check for Updates is enabled exactly when the settings button is: an updater is there and
    /// not already checking.
    #[test]
    fn check_for_updates_follows_the_settings_button() {
        let find = |bar: Vec<(String, Vec<Built>)>| {
            bar.into_iter()
                .flat_map(|(_, items)| items)
                .find(|(label, _, _, _)| label == "Check for Updates")
                .expect("a Check for Updates item")
        };
        assert_eq!(
            find(built(false, true, false)),
            item("Check for Updates", "semaphore::CheckForUpdates")
        );
        assert_eq!(
            find(built(false, false, false)),
            disabled_item("Check for Updates", "semaphore::CheckForUpdates")
        );
        assert_eq!(
            find(built(false, false, true)),
            disabled_item("Check for Updates", "semaphore::CheckForUpdates")
        );
    }

    /// Every binding the app already answers, context-free ones and the inputs' and the message
    /// list's contextual ones: a context-free binding outranks those, so this file must not take
    /// any of these keys. The edit items are the inputs' actions for that reason.
    const EXISTING_BINDINGS: &[(&str, &str)] = &[
        ("ctrl-shift-d", "the voice debug panel"),
        ("alt-up", "the previous channel or conversation"),
        ("alt-down", "the next channel or conversation"),
        ("alt-shift-up", "the previous unread one"),
        ("alt-shift-down", "the next unread one"),
        ("ctrl-/", "the shortcut sheet"),
        (
            "ctrl-shift-/",
            "the shortcut sheet, on layouts that need Shift",
        ),
        ("escape", "the pane, the menus and the dialogs"),
        ("ctrl-z", "the text inputs' undo"),
        ("ctrl-y", "the text inputs' redo"),
        ("ctrl-x", "the text inputs' cut"),
        ("ctrl-c", "the text inputs' copy, the message list's copy"),
        ("ctrl-v", "the text inputs' paste"),
        ("ctrl-a", "the text inputs' select all, the message list's"),
    ];

    #[test]
    fn new_bindings_are_unique_and_shadow_nothing() {
        let mut seen = std::collections::HashSet::new();
        for (keys, what) in BINDINGS {
            assert!(seen.insert(*keys), "{keys} is bound twice ({what})");
            assert!(
                !EXISTING_BINDINGS.iter().any(|(taken, _)| *taken == *keys),
                "{keys} ({what}) would shadow an existing binding"
            );
        }
    }

    #[test]
    fn close_to_tray_is_the_only_checked_item() {
        let checked: Vec<(String, String)> = built(true, true, false)
            .into_iter()
            .flat_map(|(menu, items)| {
                items
                    .into_iter()
                    .filter(|(_, _, checked, _)| *checked)
                    .map(move |(label, _, _, _)| (menu.clone(), label))
            })
            .collect();
        assert_eq!(checked, [("File".to_owned(), "Close to Tray".to_owned())]);
        // With the setting off, nothing is checked.
        assert!(
            built(false, true, false)
                .iter()
                .all(|(_, items)| items.iter().all(|(_, _, checked, _)| !checked))
        );
    }

    /// Every item points at an action something handles: ours have a global handler registered by
    /// `init`, the edit items are the inputs' own actions (focused inputs answer them).
    #[gpui_kit::test]
    fn every_menu_action_has_a_handler(cx: &mut gpui_kit::TestAppContext) {
        cx.update(|cx| {
            init(cx);
            for action in MenuAction::ALL {
                let item = action.item(false, true);
                let MenuItem::Action { action, .. } = item else {
                    panic!("{:?} is not an action item", action);
                };
                assert!(
                    cx.is_action_available(&*action),
                    "{:?} has no handler",
                    action.name()
                );
            }
        });
        // The edit items are the focused input's: gpui-base binds them in the input's context.
        let edit_names: Vec<&'static str> = EditAction::ALL
            .iter()
            .map(|action| match action.item() {
                MenuItem::Action { action, .. } => action.name(),
                _ => unreachable!("an edit item is an action"),
            })
            .collect();
        assert_eq!(
            edit_names,
            [
                "input::Undo",
                "input::Redo",
                "input::Cut",
                "input::Copy",
                "input::Paste",
                "input::SelectAll",
            ]
        );
    }
}
