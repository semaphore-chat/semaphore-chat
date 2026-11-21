//! Our primitives over gpui-kit: the look the web client's MUI gives it.
//!
//! Behaviour comes from gpui-kit's unstyled `base` layer wherever it has one (focus, keyboard,
//! accessibility roles and disabled handling), and the paint comes from [`crate::theme::Sem`], so a
//! control here looks like its MUI counterpart in any of the 72 themes.

mod assets;
mod bus;
mod controls;
mod display;
#[cfg(feature = "stories")]
mod display_stories;
#[cfg(test)]
mod display_tests;
mod fields;
#[cfg(test)]
mod keyboard_tests;
mod lists;
mod live;
mod look;
mod lounge;
mod modal;
mod overlays;
mod sheet;
#[cfg(feature = "stories")]
mod stories;
#[cfg(feature = "stories")]
mod stories_controls;
#[cfg(feature = "stories")]
mod stories_lists_overlays;
#[cfg(feature = "stories")]
mod stories_lounge;
mod surface;
mod tabs;
#[cfg(test)]
mod tests_lists_overlays;
#[cfg(test)]
mod tests_lounge;
mod typography;

pub use assets::{UiAssets, icon_path, lounge_icon_path};
pub use bus::{emit_core_event, on_core_event};
pub use controls::{
    Button, ButtonSize, CheckState, Checkbox, IconButton, IconButtonVariant, KeyCap, Orientation,
    Radio, RadioGroup, RadioOption, Slider, Switch,
};
pub use display::{
    Alert, Avatar, AvatarImages, AvatarShape, AvatarSize, AvatarStack, Badge, BadgeTone, Chip,
    ControlHeight, CountMeaning, Dimension, Icon, IconSize, LinearProgress, Pill, PillSize,
    PillTone, Presence, ProgressTone, Severity, Skeleton, Snackbar, Spinner, StackPerson, Toast,
    ToastTone, count_words, reduced_motion, set_reduced_motion,
};
pub use fields::{FieldShape, SelectField, TextField, select_state, text_state};
pub(crate) use fields::{floating_label, notched};
pub use lists::{Align, ListRow, RowSize, Table, TableColumn, TableRow};
pub use live::{HIDDEN_SIZE, LiveElement, Said, Speaker, live_node};
pub use look::{ButtonVariant, ControlSize};
pub use lounge::{
    Card, DOCK_FADE, Dock, DockDivider, DockEntry, DockItem, Island, Landmark, Padding, card_name,
    dock_fades, dock_item_name, reveal_scroll,
};
pub use overlays::{
    ANCHOR_GAP, Dialog, DialogCloseReason, DialogSize, Menu, MenuCloseReason, MenuEntry, MenuItem,
    MenuTone, Paper, Placement, Popover, PopoverExt, PopoverPadding, PopoverPanel, SecondaryTone,
    Tip, with_tip,
};
pub use sheet::{Sheet, SheetCloseReason, SheetSize, sheet_is_bottom};
pub use surface::{Surface, SurfaceScope};
pub use tabs::{TabItem, Tabs, TabsVariant};
pub use typography::{Variant, link, text};

/// An action with no payload.
pub(crate) type Action = std::rc::Rc<dyn Fn(&mut gpui_kit::Window, &mut gpui_kit::App)>;
/// An action carrying the new value.
pub(crate) type ValueAction<T> = std::rc::Rc<dyn Fn(T, &mut gpui_kit::Window, &mut gpui_kit::App)>;

/// `theme.spacing(n)`: MUI's 8px unit.
pub fn spacing(n: f32) -> gpui_kit::Pixels {
    gpui_kit::px(8. * n)
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    let mut all = stories::stories();
    all.extend(display_stories::stories());
    all.extend(stories_lists_overlays::stories());
    all.extend(stories_controls::stories());
    all.extend(stories_lounge::stories());
    all
}
