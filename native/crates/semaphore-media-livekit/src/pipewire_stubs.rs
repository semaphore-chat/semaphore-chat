//! libwebrtc (inside webrtc-sys) links its own `pw_*` functions: stubs that jump through pointers
//! it fills only when one of its PipeWire capturers starts, and null until then. Our binary gets
//! those stubs, not libpipewire's functions, because webrtc-sys's archive is on the link line
//! ahead of `-lpipewire-0.3` (found by T11: `pw_init` jumped to address 0). So any Rust PipeWire
//! code in a binary with libwebrtc in it calls [`ensure`] before its first `pw_*` call: it fills
//! the pointers from the libpipewire that is loaded anyway, through libwebrtc's own initializer.
//! If libwebrtc renames it, the link fails, which is loud and early.
//!
//! libwebrtc's own screen and camera capturers fill the same pointers the same way when they
//! start, from the same library, so the order between them and us doesn't matter.

use std::ffi::c_void;

unsafe extern "C" {
    /// `void modules_portal::InitializePipewire(void* module)`, from webrtc's generated stubs
    /// (Chromium's generate_stubs.py: it dlsyms every stubbed function from `module`).
    #[link_name = "_ZN14modules_portal18InitializePipewireEPv"]
    fn initialize_pipewire(module: *mut c_void);
    /// `bool modules_portal::IsPipewireInitialized()`.
    #[link_name = "_ZN14modules_portal21IsPipewireInitializedEv"]
    fn is_pipewire_initialized() -> bool;
}

/// Makes libwebrtc's `pw_*` stubs call libpipewire. Idempotent; the first result is kept.
pub fn ensure() -> Result<(), String> {
    static DONE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    DONE.get_or_init(|| unsafe {
        if is_pipewire_initialized() {
            return Ok(());
        }
        let handle = libc::dlopen(c"libpipewire-0.3.so.0".as_ptr(), libc::RTLD_NOW);
        if handle.is_null() {
            return Err("libpipewire-0.3.so.0 isn't installed".into());
        }
        // The handle stays open for the life of the process, as libpipewire does anyway.
        initialize_pipewire(handle);
        if is_pipewire_initialized() {
            Ok(())
        } else {
            Err("libpipewire lacks a function libwebrtc's stubs need".into())
        }
    })
    .clone()
}
