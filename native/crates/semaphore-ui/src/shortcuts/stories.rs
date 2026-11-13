//! The shortcut sheet's stories: the sheet over a dimmed page, at desktop and phone width.

use super::ShortcutSheet;
use crate::dms::stories::dialog_framed;
use crate::stories::Story;
use gpui_kit::*;

fn sheet(window: &mut Window, cx: &mut App) -> AnyView {
    let sheet = cx.new(|cx| ShortcutSheet::new(window, cx));
    dialog_framed(sheet.into(), cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("shortcut-sheet", |_, window, cx| sheet(window, cx)),
        Story::new("shortcut-sheet-phone", |_, window, cx| sheet(window, cx)),
    ]
}
