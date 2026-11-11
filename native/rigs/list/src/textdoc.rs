//! Arm B: the transcript as one kit `TextView` document. Images are left out: this arm exists to
//! find out what the kit's own virtualized document does, and leaving them out flatters it.

use crate::data::{Kind, Message, Seg};
use gpui_kit::base::text::{
    InlineElement, InlineRenderContext, MarkdownNode, MarkdownParseContext, MarkdownPlugin,
    markdown_ast,
};
use gpui_kit::prelude::*;
use gpui_kit::{App, Window, div, px, rgb};

pub struct EmojiPlugin;

impl MarkdownPlugin for EmojiPlugin {
    fn name(&self) -> &str {
        "emoji"
    }
    fn parse(
        &self,
        node: &markdown_ast::Node,
        _: &MarkdownParseContext<'_>,
    ) -> Option<MarkdownNode> {
        let markdown_ast::Node::Image(image) = node else {
            return None;
        };
        let name = image.url.strip_prefix("emoji:")?;
        Some(MarkdownNode::new("emoji", ()).text(format!(":{name}:")))
    }
    fn render_inline(
        &self,
        _: &MarkdownNode,
        _: &InlineRenderContext,
        _: &mut Window,
        _: &mut App,
    ) -> Option<InlineElement> {
        Some(
            InlineElement::new(div().w(px(16.)).h(px(16.)).bg(rgb(0xffcc00)))
                .with_baseline(px(12.)),
        )
    }
}

/// A message as a markdown block, inline emoji as images the plugin claims.
pub fn message_markdown(message: &Message) -> String {
    match message.kind {
        Kind::Code => format!("```\n{}\n```", message.display),
        _ => {
            let display: &str = &message.display;
            let mut out = String::new();
            let mut start = 0;
            for seg in &message.segs {
                let piece = &display[start as usize..seg.end() as usize];
                match seg {
                    Seg::Text { .. } => out.push_str(piece),
                    Seg::Bold { .. } => out.push_str(&format!("**{}** ", piece.trim_end())),
                    Seg::Link { url, .. } => out.push_str(&format!("[{piece}]({url})")),
                    Seg::Emoji { name, .. } => out.push_str(&format!("![{name}](emoji:{name})")),
                }
                start = seg.end();
            }
            if out.is_empty() {
                format!("(image {})", message.id)
            } else {
                out
            }
        }
    }
}
