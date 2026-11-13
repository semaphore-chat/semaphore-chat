//! W7's image-thumbnail conditions: which file route the list asked for, per file, and the box
//! it drew.
//!
//! ```text
//! expect core w7t thumbnail FILE_ID 1   # exactly one GET /api/file/{id}/thumbnail
//! expect core w7t full FILE_ID 0        # no GET /api/file/{id}
//! wait core w7t box "two pictures" portrait.png 250 500
//! ```
//!
//! The request conditions read the fake server's recorded requests, whose `path` names the file;
//! the existing `requests NAME` counters only know an operation, so they cannot tell one file's
//! thumbnail from another's. `box` measures the drawn image element (`("image", seq << 8 | index)`)
//! in the newest row containing the text, which is the box the attachment's dimensions reserve.

use anyhow::{Result, anyhow, bail};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;

/// W7's thumbnail conditions.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Thumbs {
    /// Exactly this many `GET /api/file/{id}/thumbnail` requests.
    Thumbnail(String, usize),
    /// Exactly this many `GET /api/file/{id}` requests.
    Full(String, usize),
    /// The drawn image for `filename` in the newest row containing `text` is `width` x `height`.
    Box {
        text: String,
        filename: String,
        width: f32,
        height: f32,
    },
}

fn number(word: &str) -> Result<usize> {
    word.parse().map_err(|_| anyhow!("not a number: {word}"))
}

/// The words after `w7t`.
pub(crate) fn parse(words: &[&str]) -> Result<Thumbs> {
    Ok(match words {
        ["thumbnail", file_id, count] => Thumbs::Thumbnail((*file_id).into(), number(count)?),
        ["full", file_id, count] => Thumbs::Full((*file_id).into(), number(count)?),
        ["box", text, filename, width, height] => Thumbs::Box {
            text: (*text).into(),
            filename: (*filename).into(),
            width: width
                .parse()
                .map_err(|_| anyhow!("{width} is not a box width"))?,
            height: height
                .parse()
                .map_err(|_| anyhow!("{height} is not a box height"))?,
        },
        _ => bail!("not a w7t condition: {}", words.join(" ")),
    })
}

impl super::Rig {
    pub(crate) fn w7t_holds(&mut self, condition: &Thumbs) -> Result<bool> {
        match condition {
            Thumbs::Thumbnail(file_id, count) => Ok(self.route_requests(
                "FileController_getFileThumbnail",
                &format!("/api/file/{file_id}/thumbnail"),
            )? == *count),
            Thumbs::Full(file_id, count) => Ok(self
                .route_requests("FileController_getFile", &format!("/api/file/{file_id}"))?
                == *count),
            Thumbs::Box {
                text,
                filename,
                width,
                height,
            } => {
                let (rows, _, _) = self.rows()?;
                let Some(row) = rows
                    .iter()
                    .rev()
                    .find(|row| row.display.contains(text.as_str()))
                else {
                    return Ok(false);
                };
                let Some(index) = row
                    .attachments
                    .iter()
                    .position(|attachment| attachment.filename == *filename)
                else {
                    return Ok(false);
                };
                let id =
                    ElementId::NamedInteger("image".into(), ((row.seq as u64) << 8) | index as u64);
                let bounds = self
                    .driver
                    .query(|window| window.try_find(id).map(|element| element.bounds()))?;
                let Some(bounds) = bounds else {
                    return Ok(false);
                };
                let drawn = (f32::from(bounds.size.width), f32::from(bounds.size.height));
                Ok((drawn.0 - width).abs() <= 1.0 && (drawn.1 - height).abs() <= 1.0)
            }
        }
    }

    /// How many recorded HTTP requests finished with this operation on exactly this path.
    fn route_requests(&self, operation: &str, path: &str) -> Result<usize> {
        let answer = super::http(&self.server, "POST", "/__control/requests", "")?;
        Ok(answer["requests"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|record| {
                record["operation"].as_str() == Some(operation)
                    && record["path"].as_str() == Some(path)
            })
            .count())
    }
}
