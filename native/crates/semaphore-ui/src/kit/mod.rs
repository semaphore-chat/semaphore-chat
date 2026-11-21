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
mod lists;
mod live;
mod overlays;
#[cfg(feature = "stories")]
mod stories;
mod surface;
mod typography;

pub use assets::{UiAssets, icon_path, lounge_icon_path};
pub use bus::{emit_core_event, on_core_event};
pub use controls::{
    Button, ButtonSize, ButtonTone, ButtonVariant, CheckState, Checkbox, IconButton, Radio, Slider,
    Switch,
};
pub use display::{
    Alert, Avatar, AvatarImages, AvatarShape, AvatarSize, AvatarStack, Badge, BadgeTone, Chip,
    ControlHeight, CountMeaning, Dimension, Icon, IconSize, LinearProgress, Pill, PillSize,
    PillTone, Presence, ProgressTone, Severity, Skeleton, Snackbar, Spinner, StackPerson, Toast,
    ToastTone, count_words, reduced_motion, set_reduced_motion,
};
pub use fields::{SelectField, TextField, select_state, text_state};
pub(crate) use fields::{floating_label, notched};
pub use lists::{ListRow, Table, Tabs};
pub use live::{HIDDEN_SIZE, LiveElement, Said, Speaker, live_node};
pub use overlays::{Dialog, Menu, MenuItem, Paper, Popover, SecondaryTone, Tip, with_tip};
pub use surface::Surface;
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
    all
}
