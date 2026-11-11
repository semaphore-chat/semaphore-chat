//! The web's built-in emoji (`emojiData.ts`, exported to `assets/emoji/emoji.json` by
//! `scripts/gen-emoji.sh`) and the picker's search over them and the community's own.

use semaphore_core::model::EmojiView;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;

const JSON: &str = include_str!("../../assets/emoji/emoji.json");

pub(crate) struct Category {
    pub name: String,
    pub emoji: Vec<String>,
}

pub(crate) struct EmojiData {
    pub categories: Vec<Category>,
    /// `EMOJI_NAMES`: the first is the accessible label, all of them are search terms.
    pub names: HashMap<String, Vec<String>>,
    /// Read only by the test that keeps `QUICK_REACTIONS` in step with the web.
    #[cfg_attr(not(test), allow(dead_code))]
    pub quick_reactions: Vec<String>,
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn parse(json: &str) -> Result<EmojiData, String> {
    let root: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let categories = root["categories"]
        .as_array()
        .ok_or("no categories")?
        .iter()
        .map(|category| Category {
            name: category["name"].as_str().unwrap_or_default().to_owned(),
            emoji: strings(&category["emoji"]),
        })
        .collect();
    let names = root["names"]
        .as_object()
        .ok_or("no names")?
        .iter()
        .map(|(emoji, names)| (emoji.clone(), strings(names)))
        .collect();
    Ok(EmojiData {
        categories,
        names,
        quick_reactions: strings(&root["quickReactions"]),
    })
}

static DATA: LazyLock<EmojiData> = LazyLock::new(|| {
    // Checked in and covered by a test, so a bad file can't reach a build that runs.
    parse(JSON).unwrap_or_else(|error| panic!("assets/emoji/emoji.json: {error}"))
});

pub(crate) fn data() -> &'static EmojiData {
    &DATA
}

/// What a screen reader says for a built-in emoji: its first name, or the character itself.
pub(crate) fn label(emoji: &str) -> String {
    data()
        .names
        .get(emoji)
        .and_then(|names| names.first().cloned())
        .unwrap_or_else(|| emoji.to_owned())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SectionKey {
    Custom,
    Category(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Cell {
    Unicode(String),
    Custom(EmojiView),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Section {
    pub key: SectionKey,
    pub title: String,
    pub cells: Vec<Cell>,
}

/// The picker's sections for `query`, as `EmojiPickerContent` filters: the community's emoji whose
/// names contain it, first, then each category's emoji whose character or any name contains it.
/// Case doesn't matter; an empty query keeps everything. A section with nothing left is dropped.
pub(crate) fn sections(custom: &[EmojiView], query: &str) -> Vec<Section> {
    let query = query.trim().to_lowercase();
    let mut out = Vec::new();
    let custom: Vec<Cell> = custom
        .iter()
        .filter(|emoji| query.is_empty() || emoji.name.to_lowercase().contains(&query))
        .cloned()
        .map(Cell::Custom)
        .collect();
    if !custom.is_empty() {
        out.push(Section {
            key: SectionKey::Custom,
            title: "Custom".to_owned(),
            cells: custom,
        });
    }
    let data = data();
    for category in &data.categories {
        let cells: Vec<Cell> = category
            .emoji
            .iter()
            .filter(|emoji| {
                query.is_empty()
                    || emoji.contains(&query)
                    || data.names.get(*emoji).is_some_and(|names| {
                        names
                            .iter()
                            .any(|name| name.to_lowercase().contains(&query))
                    })
            })
            .cloned()
            .map(Cell::Unicode)
            .collect();
        if cells.is_empty() {
            continue;
        }
        let title = if query.is_empty() {
            category.name.clone()
        } else {
            format!("{} ({})", category.name, cells.len())
        };
        out.push(Section {
            key: SectionKey::Category(category.name.clone()),
            title,
            cells,
        });
    }
    out
}
