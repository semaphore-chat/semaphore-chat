//! The Lounge frame's call slot (design §3.5-3.6, §5), the native side of
//! `frontend/src/shell/lounge/pieces/call/`: in a call, the call surface (when there is video to
//! offer or your own share) above the call bar; out of a call, the voice notice. The kit's
//! CallStack arranges them.

mod bar;
mod notice;
#[cfg(feature = "stories")]
pub mod stories;
mod surface;
#[cfg(test)]
mod tests;

pub use bar::{
    CallBar, CallBarLine, CallBarModel, CallPhase, LineTone, MicMode, call_bar_line,
    mic_unavailable_reason,
};
pub use notice::{
    NoticeSeverity, VoiceNoticeBar, VoiceNoticeModel, ended_notice, join_failed_notice,
};
pub use surface::{
    CallSurface, OFFERED_ROWS, SurfaceActions, SurfaceTile, TileKind, offered_summary,
    shows_surface, surface_tiles, tile_label,
};
