//! The notification-area icon, with `Shell_NotifyIconW`, and the taskbar's overlay dot.
//!
//! A hidden top-level window of our own receives the icon's callbacks on this thread's message
//! loop. Not a message-only window: those don't get `TaskbarCreated`, which is how a restarted
//! Explorer asks for icons again. Commands from other threads are queued on the channel and the
//! loop woken with a posted message.

use super::{
    CHECK_FOR_UPDATES, CLOSE_TO_TRAY, Command, QUIT, SHOW_HIDE, Shared, TrayOptions, TrayStatus,
    tooltip,
};
use crate::icon::{Rgba, app_icon, with_dot};
use crate::{DesktopEvent, DesktopEventSink};
use std::sync::Arc;
use std::sync::mpsc;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateBitmap, CreateDIBSection, DIB_RGB_COLORS,
    DeleteObject,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{GetDpiForSystem, GetSystemMetricsForDpi};
use windows_sys::Win32::UI::Shell::{
    NIF_ICON, NIF_MESSAGE, NIF_SHOWTIP, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY, NIM_SETVERSION,
    NIN_SELECT, NOTIFYICONDATAW, Shell_NotifyIconW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreateIconIndirect, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyIcon,
    DestroyMenu, DestroyWindow, DispatchMessageW, GWLP_USERDATA, GetCursorPos, GetMessageW,
    GetWindowLongPtrW, HICON, ICONINFO, MF_CHECKED, MF_GRAYED, MF_SEPARATOR, MF_STRING, MSG,
    PostMessageW, PostQuitMessage, RegisterClassW, RegisterWindowMessageW, SM_CXSMICON,
    SetForegroundWindow, SetWindowLongPtrW, TPM_NONOTIFY, TPM_RETURNCMD, TPM_RIGHTBUTTON,
    TrackPopupMenuEx, TranslateMessage, WM_APP, WM_CONTEXTMENU, WM_NULL, WNDCLASSW, WS_OVERLAPPED,
};

/// The icon's callback message.
const WM_TRAY: u32 = WM_APP + 1;
/// "Look at the command channel."
const WM_WAKE: u32 = WM_APP + 2;
const ICON_ID: u32 = 1;
const NOTIFYICON_VERSION_4: u32 = 4;
/// `NIN_SELECT | NINF_KEY`: the icon chosen with the keyboard.
const NIN_KEYSELECT: u32 = NIN_SELECT | 1;

const MENU_SHOW_HIDE: usize = 1;
const MENU_CLOSE_TO_TRAY: usize = 2;
const MENU_CHECK_FOR_UPDATES: usize = 3;
const MENU_QUIT: usize = 4;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// An `HICON` from straight-alpha RGBA: a 32-bit top-down DIB for the colour, an empty mask.
fn hicon(icon: &Rgba) -> HICON {
    let size = icon.size as i32;
    let header = BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: size,
        biHeight: -size,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..Default::default()
    };
    let info = BITMAPINFO {
        bmiHeader: header,
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    // SAFETY: a DIB section we fill and hand to the icon, then delete.
    unsafe {
        let color = CreateDIBSection(
            std::ptr::null_mut(),
            &info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if color.is_null() || bits.is_null() {
            return std::ptr::null_mut();
        }
        let bgra = icon.to_bgra();
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), bgra.len());
        let mask = CreateBitmap(size, size, 1, 1, std::ptr::null());
        let icon_info = ICONINFO {
            fIcon: 1,
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask,
            hbmColor: color,
        };
        let handle = CreateIconIndirect(&icon_info);
        DeleteObject(color);
        DeleteObject(mask);
        handle
    }
}

struct State {
    sink: DesktopEventSink,
    shared: Arc<Shared>,
    commands: mpsc::Receiver<Command>,
    plain: HICON,
    dotted: HICON,
    unread: u32,
    close_to_tray: bool,
    updates_enabled: bool,
    taskbar_created: u32,
    taskbar: Option<Taskbar>,
    app_window: Option<HWND>,
}

/// The taskbar button's overlay icon, over COM on this thread.
struct Taskbar(windows::Win32::UI::Shell::ITaskbarList3);

impl Taskbar {
    fn new() -> Option<Self> {
        use windows::Win32::System::Com::{
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        };
        use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList};
        // SAFETY: this thread's apartment, entered once; the list lives as long as the thread.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().ok()?;
            let list: ITaskbarList3 =
                CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
            list.HrInit().ok()?;
            Some(Self(list))
        }
    }

    fn set_overlay(&self, window: HWND, icon: Option<HICON>, description: &str) {
        let description = windows::core::HSTRING::from(description);
        // SAFETY: a window handle the app gave us and an icon we own (or none).
        let result = unsafe {
            self.0.SetOverlayIcon(
                windows::Win32::Foundation::HWND(window),
                windows::Win32::UI::WindowsAndMessaging::HICON(
                    icon.unwrap_or(std::ptr::null_mut()),
                ),
                &description,
            )
        };
        if let Err(error) = result {
            log::debug!("tray: taskbar overlay not set: {error}");
        }
    }
}

impl State {
    fn data(&self, window: HWND) -> NOTIFYICONDATAW {
        let mut data = NOTIFYICONDATAW {
            cbSize: size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: window,
            uID: ICON_ID,
            uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_SHOWTIP,
            uCallbackMessage: WM_TRAY,
            hIcon: if self.unread > 0 {
                self.dotted
            } else {
                self.plain
            },
            ..Default::default()
        };
        let tip = wide(&tooltip(self.unread));
        let length = tip.len().min(data.szTip.len());
        data.szTip[..length].copy_from_slice(&tip[..length]);
        data.szTip[data.szTip.len() - 1] = 0;
        data
    }

    fn add(&self, window: HWND) {
        let mut data = self.data(window);
        // SAFETY: a filled-in NOTIFYICONDATAW for our window.
        let added = unsafe { Shell_NotifyIconW(NIM_ADD, &data) } != 0;
        data.Anonymous.uVersion = NOTIFYICON_VERSION_4;
        // SAFETY: as above.
        unsafe { Shell_NotifyIconW(NIM_SETVERSION, &data) };
        self.shared.set_status(if added {
            TrayStatus::Shown
        } else {
            TrayStatus::NoHost
        });
    }

    fn modify(&self, window: HWND) {
        let data = self.data(window);
        // SAFETY: as in `add`.
        if unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) } == 0 {
            // Explorer isn't there; `TaskbarCreated` adds it when it is.
            self.shared.set_status(TrayStatus::NoHost);
        }
    }

    fn overlay(&self) {
        if let (Some(taskbar), Some(window)) = (&self.taskbar, self.app_window) {
            let icon = (self.unread > 0).then_some(self.dotted);
            taskbar.set_overlay(window, icon, &tooltip(self.unread));
        }
    }

    /// Drains the command channel. False once it's time to go.
    fn commands(&mut self, window: HWND) -> bool {
        while let Ok(command) = self.commands.try_recv() {
            match command {
                Command::Unread(count) if count != self.unread => {
                    self.unread = count;
                    self.modify(window);
                    self.overlay();
                }
                Command::Unread(_) => {}
                Command::CloseToTray(on) => self.close_to_tray = on,
                Command::Updates(enabled) => self.updates_enabled = enabled,
                Command::TaskbarWindow(handle) => {
                    self.app_window = Some(handle as HWND);
                    self.overlay();
                }
                Command::Shutdown => return false,
            }
        }
        true
    }
}

/// The context menu. `TrackPopupMenuEx` runs a modal loop that dispatches messages back into
/// `window_proc`, so no `&mut State` is held across it: the state is read before and touched after.
///
/// # Safety
/// `state` is the window's live `State`.
unsafe fn show_menu(window: HWND, state: *mut State) {
    // SAFETY: a short read; see above.
    let close_to_tray = unsafe { (*state).close_to_tray };
    let updates_enabled = unsafe { (*state).updates_enabled };
    // SAFETY: a menu we create, show and destroy here.
    let chosen = unsafe {
        let menu = CreatePopupMenu();
        if menu.is_null() {
            return;
        }
        let show_hide = wide(SHOW_HIDE);
        let close = wide(CLOSE_TO_TRAY);
        let check_for_updates = wide(CHECK_FOR_UPDATES);
        let quit = wide(QUIT);
        AppendMenuW(menu, MF_STRING, MENU_SHOW_HIDE, show_hide.as_ptr());
        AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
        let checked = if close_to_tray { MF_CHECKED } else { 0 };
        AppendMenuW(
            menu,
            MF_STRING | checked,
            MENU_CLOSE_TO_TRAY,
            close.as_ptr(),
        );
        AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
        let updates = if updates_enabled { 0 } else { MF_GRAYED };
        AppendMenuW(
            menu,
            MF_STRING | updates,
            MENU_CHECK_FOR_UPDATES,
            check_for_updates.as_ptr(),
        );
        AppendMenuW(menu, MF_STRING, MENU_QUIT, quit.as_ptr());
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor);
        // Without this the menu doesn't close when clicking elsewhere (KB135788).
        SetForegroundWindow(window);
        let chosen = TrackPopupMenuEx(
            menu,
            TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
            cursor.x,
            cursor.y,
            window,
            std::ptr::null(),
        ) as usize;
        PostMessageW(window, WM_NULL, 0, 0);
        DestroyMenu(menu);
        chosen
    };
    // SAFETY: the modal loop is over; nothing else borrows the state now.
    let state = unsafe { &mut *state };
    match chosen {
        MENU_SHOW_HIDE => (state.sink)(DesktopEvent::ToggleWindow),
        MENU_CLOSE_TO_TRAY => {
            state.close_to_tray = !state.close_to_tray;
            (state.sink)(DesktopEvent::SetCloseToTray(state.close_to_tray));
        }
        MENU_CHECK_FOR_UPDATES => (state.sink)(DesktopEvent::CheckForUpdates),
        MENU_QUIT => (state.sink)(DesktopEvent::Quit),
        _ => {}
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // SAFETY: set right after the window was made; null before.
    let pointer = unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) } as *mut State;
    if message == WM_TRAY && !pointer.is_null() {
        // NOTIFYICON_VERSION_4: the event is in the low word of lParam.
        match (lparam as u32) & 0xffff {
            // SAFETY: the window's state, borrowed for the call only.
            NIN_SELECT | NIN_KEYSELECT => (unsafe { &*pointer }.sink)(DesktopEvent::ToggleWindow),
            // SAFETY: as documented on `show_menu`.
            WM_CONTEXTMENU => unsafe { show_menu(window, pointer) },
            _ => {}
        }
        return 0;
    }
    // SAFETY: as above; no other borrow is live outside `show_menu`'s modal loop.
    if let Some(state) = unsafe { pointer.as_mut() } {
        if message == WM_WAKE {
            if !state.commands(window) {
                // SAFETY: on this thread's queue.
                unsafe { PostQuitMessage(0) };
            }
            return 0;
        }
        if message == state.taskbar_created && state.taskbar_created != 0 {
            state.add(window);
            return 0;
        }
    }
    // SAFETY: the default for everything else.
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

pub(super) fn run(
    options: TrayOptions,
    sink: DesktopEventSink,
    shared: Arc<Shared>,
    commands: mpsc::Receiver<Command>,
) {
    // SAFETY: plain Win32 calls; the window, icons and state are torn down below on this thread.
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class = wide("SemaphoreTrayWindow");
        let class_info = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            ..Default::default()
        };
        RegisterClassW(&class_info);
        let title = wide("Semaphore tray");
        let window = CreateWindowExW(
            0,
            class.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if window.is_null() {
            log::warn!("tray: cannot create its window");
            shared.set_status(TrayStatus::Failed);
            return;
        }
        let size = GetSystemMetricsForDpi(SM_CXSMICON, GetDpiForSystem()).clamp(16, 64) as u32;
        let base = app_icon(size);
        let taskbar_created = RegisterWindowMessageW(wide("TaskbarCreated").as_ptr());
        let state = Box::into_raw(Box::new(State {
            sink,
            shared: shared.clone(),
            commands,
            plain: hicon(&base),
            dotted: hicon(&with_dot(&base)),
            unread: 0,
            close_to_tray: options.close_to_tray,
            updates_enabled: options.updates_enabled,
            taskbar_created,
            taskbar: Taskbar::new(),
            app_window: None,
        }));
        SetWindowLongPtrW(window, GWLP_USERDATA, state as isize);
        let window_for_wake = window as isize;
        // Posting to a window that lives until the loop below ends; afterwards the post fails
        // harmlessly.
        shared.set_waker(Box::new(move || {
            PostMessageW(window_for_wake as HWND, WM_WAKE, 0, 0);
        }));
        (*state).add(window);
        // Commands sent before the waker existed.
        (*state).commands(window);

        let mut message = MSG::default();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        let data = (*state).data(window);
        Shell_NotifyIconW(NIM_DELETE, &data);
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        let state = Box::from_raw(state);
        if let (Some(taskbar), Some(app_window)) = (&state.taskbar, state.app_window) {
            taskbar.set_overlay(app_window, None, "");
        }
        DestroyIcon(state.plain);
        DestroyIcon(state.dotted);
        DestroyWindow(window);
        shared.set_status(TrayStatus::Failed);
    }
}
