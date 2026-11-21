//! Icons from `semaphore-design`, served next to gpui-kit's own assets.

use gpui_kit::assets::Assets;
use gpui_kit::{AssetSource, Result, SharedString};
use semaphore_design::{Icon, LoungeIcon};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::LazyLock;

/// Under a prefix of their own: gpui-kit has `icons/check.svg` too, and its components expect theirs.
const PREFIX: &str = "mui/";
/// The design system's Lucide set (`design/icons/icons.json`).
const LOUNGE_PREFIX: &str = "lounge/";

static ICONS: LazyLock<HashMap<String, &'static [u8]>> = LazyLock::new(|| {
    Icon::ALL
        .iter()
        .map(|icon| (format!("{PREFIX}{}", icon.asset_path()), icon.svg()))
        .chain(
            LoungeIcon::ALL
                .iter()
                .map(|icon| (format!("{LOUNGE_PREFIX}{}", icon.asset_path()), icon.svg())),
        )
        .collect()
});

/// Where GPUI's `svg().path(..)` finds a web icon.
pub fn icon_path(icon: Icon) -> SharedString {
    format!("{PREFIX}{}", icon.asset_path()).into()
}

/// Our [`AssetSource`]: give it to the application, or a window's icons draw nothing.
/// The asset path of one of the design system's icons.
pub fn lounge_icon_path(icon: LoungeIcon) -> SharedString {
    format!("{LOUNGE_PREFIX}{}", icon.asset_path()).into()
}

pub struct UiAssets;

impl AssetSource for UiAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if let Some(bytes) = ICONS.get(path) {
            return Ok(Some(Cow::Borrowed(*bytes)));
        }
        Assets.load(path)
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Assets.list(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_design_icon_resolves_and_kit_assets_still_do() {
        for icon in Icon::ALL {
            let bytes = UiAssets.load(&icon_path(*icon)).unwrap().unwrap();
            assert!(bytes.starts_with(b"<svg"));
        }
        for icon in LoungeIcon::ALL {
            let bytes = UiAssets.load(&lounge_icon_path(icon)).unwrap().unwrap();
            assert_eq!(bytes, icon.svg(), "{icon:?}");
            assert!(
                String::from_utf8_lossy(&bytes).contains("<svg "),
                "{icon:?}"
            );
        }
        assert!(UiAssets.load("icons/chevron-down.svg").unwrap().is_some());
    }
}
