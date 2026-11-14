//! `semaphore://` links: finding them in a launch's arguments, and telling the OS that this app opens
//! them.
//!
//! Nothing here trusts a link. [`from_args`] only picks candidates by prefix and length; the app
//! parses each one with `semaphore_ui::nav::parse_deep_link` and drops what doesn't parse.
//!
//! - **Linux:** a desktop entry with `MimeType=x-scheme-handler/semaphore;` in the user's
//!   applications directory, and our entry as the scheme's default in the user's `mimeapps.list`,
//!   as Electron's `setAsDefaultProtocolClient` does through `xdg-settings`. Skipped when a package
//!   installed an entry with our id, which then owns the registration.
//! - **Windows:** `HKCU\Software\Classes\semaphore` with `URL Protocol` and an open command.

use semaphore_core::platform::CoreError;
use std::path::{Path, PathBuf};

/// The scheme, as the OS registers it.
pub const SCHEME: &str = "semaphore";

/// The desktop entry's id (its file name) and the Wayland app id, which must match for the
/// compositor to find the icon.
pub const APP_ID: &str = "app.semaphorechat.semaphore";

/// Longer is garbage: `deep-link-parser.ts` caps a link at this too.
pub const MAX_LINK_LENGTH: usize = 2048;

/// At most this many links from one launch.
pub const MAX_LINKS: usize = 8;

/// The arguments that look like `semaphore://` links, in order. A prefix check, not validation.
pub fn from_args<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    args.iter()
        .map(AsRef::as_ref)
        .filter(|arg| is_candidate(arg))
        .take(MAX_LINKS)
        .map(str::to_owned)
        .collect()
}

/// Whether a string could be one of our links: our scheme (any case), `://`, and not too long.
pub fn is_candidate(arg: &str) -> bool {
    arg.len() <= MAX_LINK_LENGTH
        && arg
            .get(..SCHEME.len() + 3)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("semaphore://"))
}

/// What to register: the program a link starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterTarget {
    /// The executable; on Linux the AppImage itself when running from one (`$APPIMAGE`).
    pub exe: PathBuf,
    /// Linux: `$XDG_DATA_HOME` (`~/.local/share`).
    pub data_home: PathBuf,
    /// Linux: `$XDG_CONFIG_HOME` (`~/.config`).
    pub config_home: PathBuf,
    /// Linux: `$XDG_DATA_DIRS`, where packages install desktop entries.
    pub data_dirs: Vec<PathBuf>,
}

impl RegisterTarget {
    /// This process, with the XDG directories from the environment. `None` when there's no home
    /// directory or the executable can't be found.
    pub fn from_env() -> Option<Self> {
        let home = directories::BaseDirs::new()?;
        let exe = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| std::env::current_exe().ok())?;
        let data_dirs = std::env::var_os("XDG_DATA_DIRS")
            .filter(|dirs| !dirs.is_empty())
            .map(|dirs| std::env::split_paths(&dirs).collect())
            .unwrap_or_else(|| vec!["/usr/local/share".into(), "/usr/share".into()]);
        Some(Self {
            exe,
            data_home: home.data_dir().to_path_buf(),
            config_home: home.config_dir().to_path_buf(),
            data_dirs,
        })
    }
}

/// What a registration did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Registered {
    /// Written now, or already as it should be.
    Ours,
    /// A package installed an entry with our id; it owns the registration.
    Packaged(PathBuf),
    /// `mimeapps.list` is a symlink (home-manager, stow): another tool manages it, so nothing
    /// was written.
    ManagedElsewhere(PathBuf),
}

/// Registers the scheme for `target`, writing only what differs. Every start may call it.
pub fn register(target: &RegisterTarget) -> Result<Registered, CoreError> {
    #[cfg(windows)]
    return windows::register(target);
    #[cfg(not(windows))]
    return linux::register(target);
}

/// Who opens `semaphore://` links now, as far as this user's settings say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkStatus {
    /// Registered for this executable, as `register` would leave it.
    Ours,
    /// A package installed an entry with our id; it owns the registration.
    Packaged(PathBuf),
    /// Another program is the default handler: its desktop id (Linux) or open command (Windows).
    Another(String),
    /// Nothing handles the scheme.
    NotRegistered,
    /// `mimeapps.list` is a symlink (home-manager, stow): another tool manages it, and this app
    /// won't replace it.
    ManagedElsewhere(PathBuf),
}

/// Reads who opens `semaphore://` links for `target`, writing nothing.
pub fn status(target: &RegisterTarget) -> Result<LinkStatus, CoreError> {
    #[cfg(windows)]
    return windows::status(target);
    #[cfg(not(windows))]
    return linux::status(target);
}

/// What an unregistration did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unregistered {
    /// This app's registration is gone.
    Removed,
    /// A package installed it; only the package can remove it.
    Packaged(PathBuf),
    /// Another program owns the scheme, or nothing does: left alone.
    NotOurs,
    /// `mimeapps.list` is managed by another tool (a symlink): left alone.
    ManagedElsewhere(PathBuf),
}

/// Rewrites a registration this app wrote in an older form (Windows: an open command without
/// `--`) to the current one. True if it rewrote something. Only a registration that is this
/// executable's is touched; everywhere else, and when it's current, nothing is written.
pub fn upgrade(target: &RegisterTarget) -> Result<bool, CoreError> {
    #[cfg(windows)]
    return windows::upgrade(target);
    #[cfg(not(windows))]
    {
        let _ = target;
        Ok(false)
    }
}

/// Removes this app's registration, and only ever the parts this user can undo: no `sudo`, no
/// package files. Left alone when another program owns the scheme.
///
/// **Linux:** the `x-scheme-handler/semaphore` default in the user's `mimeapps.list` goes (when it
/// names our entry), then the entry itself, if it is the generated one, and the icon. Other
/// handler lists (`~/.config/<desktop>-mimeapps.list`, `[Added Associations]`, `/usr/share`) are
/// not ours to edit: a desktop environment that reads a per-desktop list may still offer the
/// scheme until it is told again.
///
/// **Windows:** `HKCU\Software\Classes\semaphore` is deleted, when its open command starts this
/// executable (the same test the installer's uninstaller makes).
pub fn unregister(target: &RegisterTarget) -> Result<Unregistered, CoreError> {
    #[cfg(windows)]
    return windows::unregister(target);
    #[cfg(not(windows))]
    return linux::unregister(target);
}

/// The default handler `mimeapps.list` names for `mime`, if any.
pub fn default_handler(mimeapps: &str, mime: &str) -> Option<String> {
    let mut in_defaults = false;
    for line in mimeapps.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_defaults = line == "[Default Applications]";
            continue;
        }
        if !in_defaults {
            continue;
        }
        if let Some((key, value)) = line.split_once('=')
            && key.trim() == mime
        {
            return value
                .split(';')
                .next()
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_owned);
        }
    }
    None
}

/// A marker in the desktop entry we write, so a later start knows the file is ours to replace.
pub const GENERATED_KEY: &str = "X-Semaphore-Generated";

/// Quotes one argument of a desktop entry's `Exec` key: double quotes, with `"`, `` ` ``, `$` and
/// `\` escaped, and `%` doubled. The key's value is also a string, whose own escaping is undone
/// first, so every backslash of the quoting is doubled again (the spec's `\\\\` and `\\$`). `None` for a path a desktop entry can't carry (a control character, or not UTF-8).
pub fn exec_arg(path: &Path) -> Option<String> {
    let text = path.to_str()?;
    if text.chars().any(char::is_control) {
        return None;
    }
    let mut quoted = String::from("\"");
    for character in text.chars() {
        match character {
            // `\$`: the string escape leaves `\$`, the Exec quoting then `$`.
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(character);
            }
            // Escaped for the Exec quoting, then for the string value: four in the file.
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    Some(quoted)
}

/// The desktop entry for `exe`.
pub fn desktop_entry(exe: &Path) -> Option<String> {
    let exec = exec_arg(exe)?;
    Some(format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Semaphore\n\
         Comment=Voice and text chat\n\
         Exec={exec} %u\n\
         Icon={APP_ID}\n\
         Terminal=false\n\
         Categories=Network;Chat;InstantMessaging;\n\
         MimeType=x-scheme-handler/{SCHEME};\n\
         StartupWMClass={APP_ID}\n\
         {GENERATED_KEY}=true\n"
    ))
}

/// `mimeapps.list` with `mime=desktop_id` as the default, everything else as it was. `None` when
/// it already says so.
pub fn with_default_handler(existing: &str, mime: &str, desktop_id: &str) -> Option<String> {
    const SECTION: &str = "[Default Applications]";
    let wanted = format!("{mime}={desktop_id}");
    let mut lines: Vec<String> = existing.lines().map(str::to_owned).collect();
    let section = lines.iter().position(|line| line.trim() == SECTION);
    match section {
        Some(start) => {
            let end = lines[start + 1..]
                .iter()
                .position(|line| line.trim_start().starts_with('['))
                .map_or(lines.len(), |offset| start + 1 + offset);
            let existing_key = (start + 1..end).find(|&index| {
                lines[index]
                    .split_once('=')
                    .is_some_and(|(key, _)| key.trim() == mime)
            });
            match existing_key {
                Some(index) if lines[index].trim() == wanted => return None,
                Some(index) => lines[index] = wanted,
                None => {
                    // After the section's last non-blank line.
                    let mut at = end;
                    while at > start + 1 && lines[at - 1].trim().is_empty() {
                        at -= 1;
                    }
                    lines.insert(at, wanted);
                }
            }
        }
        None => {
            if lines.last().is_some_and(|line| !line.trim().is_empty()) {
                lines.push(String::new());
            }
            lines.push(SECTION.to_owned());
            lines.push(wanted);
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    Some(out)
}

/// `mimeapps.list` with its default for `mime` taken out, when that default is `desktop_id`:
/// every other line as it was. `None` when it names anything else, or nothing.
pub fn without_default_handler(existing: &str, mime: &str, desktop_id: &str) -> Option<String> {
    if default_handler(existing, mime).as_deref() != Some(desktop_id) {
        return None;
    }
    const SECTION: &str = "[Default Applications]";
    let mut lines: Vec<String> = existing.lines().map(str::to_owned).collect();
    let start = lines.iter().position(|line| line.trim() == SECTION)?;
    let end = lines[start + 1..]
        .iter()
        .position(|line| line.trim_start().starts_with('['))
        .map_or(lines.len(), |offset| start + 1 + offset);
    let key = (start + 1..end).find(|&index| {
        lines[index]
            .split_once('=')
            .is_some_and(|(key, _)| key.trim() == mime)
    })?;
    lines.remove(key);
    let mut out = lines.join("\n");
    out.push('\n');
    Some(out)
}

/// Writes `contents` to `path` through a temp file in the same directory, unless it's already
/// there.
#[cfg(not(windows))]
fn write_if_changed(path: &Path, contents: &[u8]) -> std::io::Result<bool> {
    if std::fs::read(path).is_ok_and(|current| current == contents) {
        return Ok(false);
    }
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let temp = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file"),
        std::process::id()
    ));
    std::fs::write(&temp, contents)?;
    // The file keeps its mode (a private mimeapps.list stays private).
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&temp, meta.permissions());
    }
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })?;
    Ok(true)
}

fn failed(what: &str, error: impl std::fmt::Display) -> CoreError {
    CoreError::Failed {
        message: format!("cannot register semaphore:// links: {what}: {error}"),
    }
}

#[cfg(not(windows))]
mod linux {
    use super::*;

    use crate::icon::ICON_PNG;

    /// A package's desktop entry with our id, in `$XDG_DATA_DIRS`. `~/.local/share` in that list
    /// (some sessions add it) holds our own generated entry, which is not a package's.
    fn packaged_entry(target: &RegisterTarget) -> Option<PathBuf> {
        let file_name = format!("{APP_ID}.desktop");
        let ours = target.data_home.join("applications").join(&file_name);
        target
            .data_dirs
            .iter()
            .map(|dir| dir.join("applications").join(&file_name))
            .find(|path| {
                path.is_file()
                    && !(same_file(path, &ours)
                        && std::fs::read_to_string(path)
                            .is_ok_and(|text| text.contains(&format!("{GENERATED_KEY}=true"))))
            })
    }

    fn same_file(a: &Path, b: &Path) -> bool {
        match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        }
    }

    /// `mimeapps.list`, when it is a symlink: another tool manages it.
    fn managed_mimeapps(target: &RegisterTarget) -> Option<PathBuf> {
        let path = target.config_home.join("mimeapps.list");
        std::fs::symlink_metadata(&path)
            .is_ok_and(|meta| meta.file_type().is_symlink())
            .then_some(path)
    }

    pub fn status(target: &RegisterTarget) -> Result<LinkStatus, CoreError> {
        let file_name = format!("{APP_ID}.desktop");
        if let Some(packaged) = packaged_entry(target) {
            return Ok(LinkStatus::Packaged(packaged));
        }
        if let Some(managed) = managed_mimeapps(target) {
            return Ok(LinkStatus::ManagedElsewhere(managed));
        }
        let mimeapps = match std::fs::read_to_string(target.config_home.join("mimeapps.list")) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(failed("mimeapps.list", error)),
        };
        let Some(handler) = default_handler(&mimeapps, &format!("x-scheme-handler/{SCHEME}"))
        else {
            return Ok(LinkStatus::NotRegistered);
        };
        if handler != file_name {
            return Ok(LinkStatus::Another(handler));
        }
        // Our id is the default: ours if the entry starts this executable.
        let entry = std::fs::read_to_string(target.data_home.join("applications").join(&file_name))
            .unwrap_or_default();
        let wanted = desktop_entry(&target.exe).unwrap_or_default();
        let exec = |text: &str| {
            text.lines()
                .find(|line| line.starts_with("Exec="))
                .map(str::to_owned)
        };
        Ok(if exec(&entry).is_some() && exec(&entry) == exec(&wanted) {
            LinkStatus::Ours
        } else {
            LinkStatus::Another(file_name)
        })
    }

    /// Takes the default and our own files away; a package's entry (which `status` reports as
    /// `Packaged`) and anything the user wrote are left alone.
    pub fn unregister(target: &RegisterTarget) -> Result<Unregistered, CoreError> {
        let file_name = format!("{APP_ID}.desktop");
        match status(target)? {
            LinkStatus::Ours => {}
            LinkStatus::Packaged(entry) => return Ok(Unregistered::Packaged(entry)),
            LinkStatus::ManagedElsewhere(path) => return Ok(Unregistered::ManagedElsewhere(path)),
            LinkStatus::Another(_) | LinkStatus::NotRegistered => {
                return Ok(Unregistered::NotOurs);
            }
        }
        // The default first: between the two writes the entry may point at a file that's gone,
        // which no desktop environment minds, while the other order would leave it pointing here.
        let mimeapps = target.config_home.join("mimeapps.list");
        let existing = match std::fs::read_to_string(&mimeapps) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(failed("mimeapps.list", error)),
        };
        if let Some(updated) =
            without_default_handler(&existing, &format!("x-scheme-handler/{SCHEME}"), &file_name)
        {
            write_if_changed(&mimeapps, updated.as_bytes())
                .map_err(|error| failed("mimeapps.list", error))?;
        }
        // Only the entry we wrote is ours: one the user made with our id stays theirs.
        let entry_path = target.data_home.join("applications").join(&file_name);
        if std::fs::read_to_string(&entry_path)
            .is_ok_and(|text| text.contains(&format!("{GENERATED_KEY}=true")))
        {
            std::fs::remove_file(&entry_path)
                .map_err(|error| failed("the desktop entry", error))?;
        }
        let icon = target
            .data_home
            .join("icons/hicolor/512x512/apps")
            .join(format!("{APP_ID}.png"));
        if icon.is_file() {
            std::fs::remove_file(&icon).map_err(|error| failed("the icon", error))?;
        }
        Ok(Unregistered::Removed)
    }

    pub fn register(target: &RegisterTarget) -> Result<Registered, CoreError> {
        let file_name = format!("{APP_ID}.desktop");
        if let Some(packaged) = packaged_entry(target) {
            return Ok(Registered::Packaged(packaged));
        }
        // A symlinked mimeapps.list is another tool's (home-manager, stow): writing through a temp
        // file would replace the link with a plain file. Nothing is written, the entry included.
        if let Some(managed) = managed_mimeapps(target) {
            return Ok(Registered::ManagedElsewhere(managed));
        }
        let entry_path = target.data_home.join("applications").join(&file_name);
        // A file with our id that we didn't write (the user's own, say) stays; it only loses the
        // default if it doesn't claim the scheme, which is then still ours to set.
        let foreign = std::fs::read_to_string(&entry_path)
            .is_ok_and(|text| !text.contains(&format!("{GENERATED_KEY}=true")));
        if !foreign {
            let entry = desktop_entry(&target.exe)
                .ok_or_else(|| failed("the executable's path", "not a valid desktop entry path"))?;
            write_if_changed(&entry_path, entry.as_bytes())
                .map_err(|error| failed("the desktop entry", error))?;
            let icon = target
                .data_home
                .join("icons/hicolor/512x512/apps")
                .join(format!("{APP_ID}.png"));
            write_if_changed(&icon, ICON_PNG).map_err(|error| failed("the icon", error))?;
        }
        let mimeapps = target.config_home.join("mimeapps.list");
        let existing = match std::fs::read_to_string(&mimeapps) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(failed("mimeapps.list", error)),
        };
        if let Some(updated) =
            with_default_handler(&existing, &format!("x-scheme-handler/{SCHEME}"), &file_name)
        {
            write_if_changed(&mimeapps, updated.as_bytes())
                .map_err(|error| failed("mimeapps.list", error))?;
        }
        Ok(Registered::Ours)
    }
}

/// The registry values for the scheme, as `(subkey of HKCU, value name or "" for the default,
/// data)`. Plain data, so it's tested anywhere.
pub fn registry_values(exe: &Path) -> Vec<(String, String, String)> {
    let base = format!(r"Software\Classes\{SCHEME}");
    let exe = exe.display();
    vec![
        (base.clone(), String::new(), "URL:Semaphore".into()),
        (base.clone(), "URL Protocol".into(), String::new()),
        (
            format!(r"{base}\DefaultIcon"),
            String::new(),
            format!("\"{exe}\",0"),
        ),
        (
            format!(r"{base}\shell\open\command"),
            String::new(),
            open_command(&exe.to_string()),
        ),
    ]
}

/// The scheme's open command for `exe`: `"exe" -- "%1"`. The `--` ends the app's options, so
/// whatever a link holds (a `"` that closes the quoting early, say) is never read as one.
pub fn open_command(exe: &str) -> String {
    format!("\"{exe}\" -- \"%1\"")
}

/// Which form of our open command a registered command is, for `exe`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandForm {
    /// `"exe" -- "%1"`, as this build writes it.
    Current,
    /// `"exe" "%1"`, as builds before the `--` wrote it (and their installer): still ours, and
    /// rewritten on the next start.
    Legacy,
}

/// Whether `command` is our open command for `exe`, and in which form. Paths compare as Windows
/// compares them: without case, `/` as `\`, and without a `\\?\` prefix.
pub fn command_form(command: &str, exe: &Path) -> Option<CommandForm> {
    let rest = command.trim().strip_prefix('"')?;
    let (path, args) = rest.split_once('"')?;
    if !same_windows_path(path, &exe.to_string_lossy()) {
        return None;
    }
    match args.trim() {
        r#"-- "%1""# => Some(CommandForm::Current),
        r#""%1""# => Some(CommandForm::Legacy),
        _ => None,
    }
}

/// Two Windows paths that name the same file as the registry would see it.
pub fn same_windows_path(a: &str, b: &str) -> bool {
    fn normal(path: &str) -> String {
        let path = path.replace('/', "\\");
        let path = path
            .strip_prefix(r"\\?\UNC\")
            .map(|rest| format!(r"\\{rest}"))
            .or_else(|| path.strip_prefix(r"\\?\").map(str::to_owned))
            .unwrap_or(path);
        path.to_lowercase()
    }
    normal(a) == normal(b)
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    fn read(key: HKEY, name: &[u16]) -> Option<Vec<u16>> {
        let mut size = 0u32;
        let mut kind = 0u32;
        // SAFETY: a size query with no buffer.
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || kind != REG_SZ {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: `buffer` holds `size` bytes.
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        (status == ERROR_SUCCESS).then_some(buffer)
    }

    /// One value, as text.
    fn value(subkey: &str, name: &str) -> Option<String> {
        let subkey_w = wide(subkey);
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: a valid string, and `key` is closed below.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey_w.as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &mut key,
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let text = read(key, &wide(name)).map(|data| {
            let end = data.iter().position(|&c| c == 0).unwrap_or(data.len());
            String::from_utf16_lossy(&data[..end])
        });
        // SAFETY: opened above.
        unsafe { RegCloseKey(key) };
        text
    }

    /// Ours when the open command starts this executable and every other value `register`
    /// writes is there too; another program's command names it.
    pub fn status(target: &RegisterTarget) -> Result<LinkStatus, CoreError> {
        let base = format!(r"Software\Classes\{SCHEME}");
        let command_key = format!(r"{base}\shell\open\command");
        let Some(command) = value(&command_key, "") else {
            return Ok(LinkStatus::NotRegistered);
        };
        if command_form(&command, &target.exe).is_none() {
            return Ok(LinkStatus::Another(command));
        }
        for (subkey, name, data) in registry_values(&target.exe) {
            if subkey == command_key {
                continue;
            }
            let found = value(&subkey, &name);
            let matches = match found.as_deref() {
                // The icon names the executable too: compared as a path, like the command.
                Some(found) if name.is_empty() && subkey.ends_with("DefaultIcon") => found
                    .strip_suffix(",0")
                    .and_then(|quoted| quoted.strip_prefix('"')?.strip_suffix('"'))
                    .is_some_and(|path| same_windows_path(path, &target.exe.to_string_lossy())),
                Some(found) => found == data,
                None => false,
            };
            if !matches {
                return Ok(LinkStatus::Another(format!("HKCU\\{subkey}")));
            }
        }
        Ok(LinkStatus::Ours)
    }

    /// An open command in the old form (`"exe" "%1"`) for this executable: written again in the
    /// current one.
    pub fn upgrade(target: &RegisterTarget) -> Result<bool, CoreError> {
        let command_key = format!(r"Software\Classes\{SCHEME}\shell\open\command");
        let legacy = value(&command_key, "").is_some_and(|command| {
            command_form(&command, &target.exe) == Some(CommandForm::Legacy)
        });
        if !legacy || status(target)? != LinkStatus::Ours {
            return Ok(false);
        }
        register(target)?;
        Ok(true)
    }

    /// Deletes the scheme's key, when it starts this executable. The installer's uninstaller makes
    /// the same test before it deletes the same key.
    pub fn unregister(target: &RegisterTarget) -> Result<Unregistered, CoreError> {
        match status(target)? {
            LinkStatus::Ours => {}
            LinkStatus::Another(command) => {
                log::info!("semaphore:// is registered by {command}; leaving it");
                return Ok(Unregistered::NotOurs);
            }
            LinkStatus::Packaged(entry) => return Ok(Unregistered::Packaged(entry)),
            LinkStatus::ManagedElsewhere(path) => return Ok(Unregistered::ManagedElsewhere(path)),
            LinkStatus::NotRegistered => return Ok(Unregistered::NotOurs),
        }
        let base = wide(&format!(r"Software\Classes\{SCHEME}"));
        // SAFETY: a valid string; the key is the one `status` just read.
        let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, base.as_ptr()) };
        if status != ERROR_SUCCESS {
            return Err(failed(
                "the scheme's registry key",
                format!("RegDeleteTreeW {status}"),
            ));
        }
        Ok(Unregistered::Removed)
    }

    pub fn register(target: &RegisterTarget) -> Result<Registered, CoreError> {
        for (subkey, name, data) in registry_values(&target.exe) {
            let subkey_w = wide(&subkey);
            let mut key: HKEY = std::ptr::null_mut();
            // SAFETY: valid strings, and `key` is closed below.
            let status = unsafe {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    subkey_w.as_ptr(),
                    0,
                    std::ptr::null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE | KEY_QUERY_VALUE,
                    std::ptr::null(),
                    &mut key,
                    std::ptr::null_mut(),
                )
            };
            if status != ERROR_SUCCESS {
                return Err(failed(&subkey, format!("RegCreateKeyExW {status}")));
            }
            let name_w = wide(&name);
            let data_w = wide(&data);
            let status = if read(key, &name_w).is_some_and(|current| {
                current
                    .iter()
                    .take_while(|&&c| c != 0)
                    .eq(data_w.iter().take_while(|&&c| c != 0))
            }) {
                ERROR_SUCCESS
            } else {
                // SAFETY: `data_w` is `len * 2` bytes, NUL included.
                unsafe {
                    RegSetValueExW(
                        key,
                        name_w.as_ptr(),
                        0,
                        REG_SZ,
                        data_w.as_ptr().cast(),
                        (data_w.len() * 2) as u32,
                    )
                }
            };
            // SAFETY: opened above.
            unsafe { RegCloseKey(key) };
            if status != ERROR_SUCCESS {
                return Err(failed(&subkey, format!("RegSetValueExW {status}")));
            }
        }
        Ok(Registered::Ours)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_handler_is_read_from_the_defaults_section_only() {
        let text = "[Added Associations]\nx-scheme-handler/semaphore=other.desktop;\n\n[Default Applications]\ntext/html=firefox.desktop\nx-scheme-handler/semaphore = app.semaphorechat.semaphore.desktop;old.desktop\n";
        assert_eq!(
            default_handler(text, "x-scheme-handler/semaphore").as_deref(),
            Some("app.semaphorechat.semaphore.desktop")
        );
        assert_eq!(default_handler(text, "x-scheme-handler/http"), None);
        assert_eq!(default_handler("", "x-scheme-handler/semaphore"), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn status_reads_what_register_writes_and_writes_nothing() {
        let dir =
            std::env::temp_dir().join(format!("semaphore-links-status-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let target = RegisterTarget {
            exe: dir.join("bin/semaphore-app"),
            data_home: dir.join("data"),
            config_home: dir.join("config"),
            data_dirs: vec![dir.join("system")],
        };
        assert_eq!(status(&target).unwrap(), LinkStatus::NotRegistered);
        assert!(!dir.exists(), "status wrote nothing");
        assert_eq!(register(&target).unwrap(), Registered::Ours);
        assert_eq!(status(&target).unwrap(), LinkStatus::Ours);
        // Another build registered under our id: not this executable's.
        let moved = RegisterTarget {
            exe: dir.join("elsewhere/semaphore-app"),
            ..target.clone()
        };
        assert_eq!(
            status(&moved).unwrap(),
            LinkStatus::Another(format!("{APP_ID}.desktop"))
        );
        // A package's entry owns it.
        let packaged = dir
            .join("system/applications")
            .join(format!("{APP_ID}.desktop"));
        std::fs::create_dir_all(packaged.parent().unwrap()).unwrap();
        std::fs::write(&packaged, "[Desktop Entry]\n").unwrap();
        assert_eq!(status(&target).unwrap(), LinkStatus::Packaged(packaged));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_our_scheme_is_picked_from_the_arguments() {
        let args = [
            "--server",
            "https://chat.example",
            "semaphore://community/x",
            "SEMAPHORE://join/abc",
            "semaphore:/missing-slash",
            "https://semaphore://nope",
            "semaphorex://community/x",
        ];
        assert_eq!(
            from_args(&args),
            vec!["semaphore://community/x", "SEMAPHORE://join/abc"]
        );
    }

    #[test]
    fn oversized_and_too_many_links_are_dropped() {
        let long = format!("semaphore://join/{}", "a".repeat(MAX_LINK_LENGTH));
        assert!(from_args(&[long]).is_empty());
        let many: Vec<String> = (0..20).map(|n| format!("semaphore://join/{n}")).collect();
        assert_eq!(from_args(&many).len(), MAX_LINKS);
        // Multi-byte text right at the prefix boundary doesn't panic.
        assert!(from_args(&["semaphoré://x", "é"]).is_empty());
    }

    #[test]
    fn exec_paths_are_quoted_and_escaped() {
        assert_eq!(
            exec_arg(Path::new("/opt/Semaphore Chat/semaphore")).as_deref(),
            Some("\"/opt/Semaphore Chat/semaphore\"")
        );
        assert_eq!(
            exec_arg(Path::new("/a/$b`c\"d%e")).as_deref(),
            Some("\"/a/\\\\$b\\\\`c\\\\\"d%%e\"")
        );
        assert_eq!(
            exec_arg(Path::new("/a\\b")).as_deref(),
            Some("\"/a\\\\\\\\b\"")
        );
        assert_eq!(exec_arg(Path::new("/a\nb")), None);
    }

    #[test]
    fn the_desktop_entry_claims_the_scheme() {
        let entry = desktop_entry(Path::new("/usr/bin/semaphore-app")).unwrap();
        assert!(
            entry.contains("Exec=\"/usr/bin/semaphore-app\" %u\n"),
            "{entry}"
        );
        assert!(
            entry.contains("MimeType=x-scheme-handler/semaphore;\n"),
            "{entry}"
        );
        assert!(
            entry.contains("StartupWMClass=app.semaphorechat.semaphore\n"),
            "{entry}"
        );
        assert!(entry.contains("X-Semaphore-Generated=true\n"), "{entry}");
    }

    const MIME: &str = "x-scheme-handler/semaphore";
    const ID: &str = "app.semaphorechat.semaphore.desktop";

    #[test]
    fn mimeapps_gains_a_section_when_it_has_none() {
        assert_eq!(
            with_default_handler("", MIME, ID).unwrap(),
            "[Default Applications]\nx-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n"
        );
        assert_eq!(
            with_default_handler("[Added Associations]\ntext/plain=a.desktop;", MIME, ID).unwrap(),
            "[Added Associations]\ntext/plain=a.desktop;\n\n[Default Applications]\n\
             x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n"
        );
    }

    #[test]
    fn mimeapps_keeps_other_defaults_and_replaces_ours() {
        let existing = "[Default Applications]\ntext/html=firefox.desktop\n\
                        x-scheme-handler/semaphore=old.desktop\n\n[Added Associations]\nimage/png=a.desktop;\n";
        assert_eq!(
            with_default_handler(existing, MIME, ID).unwrap(),
            "[Default Applications]\ntext/html=firefox.desktop\n\
             x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n\n\
             [Added Associations]\nimage/png=a.desktop;\n"
        );
        let added = with_default_handler(
            "[Default Applications]\ntext/html=firefox.desktop\n\n[Other]\nx=y\n",
            MIME,
            ID,
        )
        .unwrap();
        assert_eq!(
            added,
            "[Default Applications]\ntext/html=firefox.desktop\n\
             x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n\n[Other]\nx=y\n"
        );
    }

    #[test]
    fn mimeapps_that_already_says_so_is_left_alone() {
        let existing = "[Default Applications]\nx-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n";
        assert_eq!(with_default_handler(existing, MIME, ID), None);
    }

    #[test]
    fn removing_the_default_takes_only_our_line_and_only_when_it_is_ours() {
        let existing = "[Default Applications]\ntext/html=firefox.desktop\n\
                        x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n\n\
                        [Added Associations]\nimage/png=a.desktop;\n";
        assert_eq!(
            without_default_handler(existing, MIME, ID).unwrap(),
            "[Default Applications]\ntext/html=firefox.desktop\n\n\
             [Added Associations]\nimage/png=a.desktop;\n"
        );
        // Someone else's default isn't ours to take away, and an absent one is nothing to undo.
        assert_eq!(
            without_default_handler(
                "[Default Applications]\nx-scheme-handler/semaphore=other.desktop\n",
                MIME,
                ID
            ),
            None
        );
        assert_eq!(
            without_default_handler("[Default Applications]\ntext/html=x\n", MIME, ID),
            None
        );
        assert_eq!(default_handler("x-scheme-handler/semaphore=\n", MIME), None);
    }

    #[test]
    fn the_registry_values_open_the_exe_with_the_link() {
        let values = registry_values(Path::new(r"C:\Program Files\Semaphore\semaphore-app.exe"));
        assert!(values.contains(&(
            r"Software\Classes\semaphore".into(),
            "URL Protocol".into(),
            String::new()
        )));
        assert!(values.contains(&(
            r"Software\Classes\semaphore\shell\open\command".into(),
            String::new(),
            r#""C:\Program Files\Semaphore\semaphore-app.exe" -- "%1""#.into()
        )));
    }

    #[test]
    fn the_open_command_ends_options_and_the_old_form_is_still_ours() {
        let exe =
            Path::new(r"C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe");
        let current = open_command(&exe.display().to_string());
        assert_eq!(
            current,
            r#""C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe" -- "%1""#
        );
        assert_eq!(command_form(&current, exe), Some(CommandForm::Current));
        // What builds before `--` and their installer wrote: ours, to be rewritten.
        let legacy =
            r#""C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe" "%1""#;
        assert_eq!(command_form(legacy, exe), Some(CommandForm::Legacy));
        // The same file however Windows spells it.
        for spelling in [
            r#""c:\users\ava\appdata\local\programs\semaphore chat\SEMAPHORE-APP.EXE" -- "%1""#,
            r#""\\?\C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe" -- "%1""#,
            r#""C:/Users/Ava/AppData/Local/Programs/Semaphore Chat/semaphore-app.exe" "%1""#,
        ] {
            assert!(command_form(spelling, exe).is_some(), "{spelling}");
        }
        // Not ours: another program, extra arguments, another executable.
        for other in [
            r#""C:\Program Files\Semaphore Chat\Semaphore Chat.exe" "%1""#,
            r#""C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe" --server x "%1""#,
            r#""C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe" %1"#,
            r#"C:\Users\Ava\AppData\Local\Programs\Semaphore Chat\semaphore-app.exe "%1""#,
            "",
        ] {
            assert_eq!(command_form(other, exe), None, "{other}");
        }
        assert!(same_windows_path(
            r"\\?\UNC\srv\share\a.exe",
            r"\\SRV\share\A.exe"
        ));
        assert!(!same_windows_path(r"C:\a\b.exe", r"C:\a\c.exe"));
    }

    #[cfg(not(windows))]
    mod linux {
        use super::super::*;

        fn target(root: &Path) -> RegisterTarget {
            RegisterTarget {
                exe: "/opt/semaphore/semaphore-app".into(),
                data_home: root.join("data"),
                config_home: root.join("config"),
                data_dirs: vec![root.join("system")],
            }
        }

        fn temp_root(name: &str) -> PathBuf {
            let root =
                std::env::temp_dir().join(format!("semaphore-links-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            root
        }

        #[test]
        fn registering_writes_the_entry_icon_and_default_then_nothing() {
            let root = temp_root("fresh");
            let target = target(&root);
            assert_eq!(register(&target).unwrap(), Registered::Ours);
            let entry_path = root.join("data/applications/app.semaphorechat.semaphore.desktop");
            let entry = std::fs::read_to_string(&entry_path).unwrap();
            assert!(entry.contains("Exec=\"/opt/semaphore/semaphore-app\" %u"));
            assert!(
                root.join("data/icons/hicolor/512x512/apps/app.semaphorechat.semaphore.png")
                    .is_file()
            );
            let mimeapps = std::fs::read_to_string(root.join("config/mimeapps.list")).unwrap();
            assert!(
                mimeapps.contains("x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop")
            );

            let before = std::fs::metadata(&entry_path).unwrap().modified().unwrap();
            assert_eq!(register(&target).unwrap(), Registered::Ours);
            assert_eq!(
                std::fs::metadata(&entry_path).unwrap().modified().unwrap(),
                before
            );

            // A moved AppImage rewrites the entry.
            let moved = RegisterTarget {
                exe: "/home/u/Apps/Semaphore.AppImage".into(),
                ..target
            };
            register(&moved).unwrap();
            assert!(
                std::fs::read_to_string(&entry_path)
                    .unwrap()
                    .contains("Semaphore.AppImage")
            );
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn a_packaged_entry_owns_the_registration() {
            let root = temp_root("packaged");
            let packaged = root.join("system/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(packaged.parent().unwrap()).unwrap();
            std::fs::write(&packaged, "[Desktop Entry]\n").unwrap();
            assert_eq!(
                register(&target(&root)).unwrap(),
                Registered::Packaged(packaged)
            );
            assert!(!root.join("data").exists());
            assert!(!root.join("config").exists());
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn a_users_own_entry_is_kept_but_the_default_is_set() {
            let root = temp_root("foreign");
            let entry_path = root.join("data/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(entry_path.parent().unwrap()).unwrap();
            std::fs::write(&entry_path, "[Desktop Entry]\nExec=mine %u\n").unwrap();
            register(&target(&root)).unwrap();
            assert_eq!(
                std::fs::read_to_string(&entry_path).unwrap(),
                "[Desktop Entry]\nExec=mine %u\n"
            );
            assert!(
                std::fs::read_to_string(root.join("config/mimeapps.list"))
                    .unwrap()
                    .contains("semaphore")
            );
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn unregistering_takes_our_entry_icon_and_default_away_and_nothing_else() {
            let root = temp_root("unregister");
            let target = target(&root);
            register(&target).unwrap();
            let mimeapps_path = root.join("config/mimeapps.list");
            std::fs::write(
                &mimeapps_path,
                "[Default Applications]\ntext/html=firefox.desktop\n\
                 x-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n",
            )
            .unwrap();
            assert_eq!(unregister(&target).unwrap(), Unregistered::Removed);
            assert_eq!(status(&target).unwrap(), LinkStatus::NotRegistered);
            assert_eq!(
                std::fs::read_to_string(&mimeapps_path).unwrap(),
                "[Default Applications]\ntext/html=firefox.desktop\n"
            );
            assert!(
                !root
                    .join("data/applications/app.semaphorechat.semaphore.desktop")
                    .exists()
            );
            assert!(
                !root
                    .join("data/icons/hicolor/512x512/apps/app.semaphorechat.semaphore.png")
                    .exists()
            );
            // Nothing left to undo, twice over.
            assert_eq!(unregister(&target).unwrap(), Unregistered::NotOurs);
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn a_symlinked_mimeapps_list_is_managed_elsewhere_and_never_replaced() {
            let root = temp_root("symlink");
            let target = target(&root);
            let real = root.join("dotfiles/mimeapps.list");
            std::fs::create_dir_all(real.parent().unwrap()).unwrap();
            let theirs = "[Default Applications]\ntext/html=firefox.desktop\n";
            std::fs::write(&real, theirs).unwrap();
            std::fs::create_dir_all(root.join("config")).unwrap();
            let link = root.join("config/mimeapps.list");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            assert_eq!(
                status(&target).unwrap(),
                LinkStatus::ManagedElsewhere(link.clone())
            );
            assert_eq!(
                register(&target).unwrap(),
                Registered::ManagedElsewhere(link.clone())
            );
            assert!(
                std::fs::symlink_metadata(&link)
                    .unwrap()
                    .file_type()
                    .is_symlink(),
                "the link is still a link"
            );
            assert_eq!(std::fs::read_to_string(&real).unwrap(), theirs);
            assert!(!root.join("data").exists(), "nothing else was written");
            assert_eq!(
                unregister(&target).unwrap(),
                Unregistered::ManagedElsewhere(link)
            );
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn mimeapps_list_keeps_its_mode() {
            use std::os::unix::fs::PermissionsExt as _;
            let root = temp_root("mode");
            let target = target(&root);
            let mimeapps = root.join("config/mimeapps.list");
            std::fs::create_dir_all(mimeapps.parent().unwrap()).unwrap();
            std::fs::write(&mimeapps, "[Default Applications]\n").unwrap();
            std::fs::set_permissions(&mimeapps, std::fs::Permissions::from_mode(0o600)).unwrap();
            register(&target).unwrap();
            assert!(
                std::fs::read_to_string(&mimeapps)
                    .unwrap()
                    .contains("x-scheme-handler/semaphore=")
            );
            assert_eq!(
                std::fs::metadata(&mimeapps).unwrap().permissions().mode() & 0o777,
                0o600
            );
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn our_own_entry_seen_through_xdg_data_dirs_is_not_a_package() {
            let root = temp_root("xdg-dirs");
            let target = RegisterTarget {
                data_dirs: vec![root.join("data"), root.join("system")],
                ..target(&root)
            };
            assert_eq!(register(&target).unwrap(), Registered::Ours);
            assert_eq!(status(&target).unwrap(), LinkStatus::Ours);
            assert_eq!(unregister(&target).unwrap(), Unregistered::Removed);
            // A package's entry elsewhere still owns it.
            let packaged = root.join("system/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(packaged.parent().unwrap()).unwrap();
            std::fs::write(&packaged, "[Desktop Entry]\n").unwrap();
            assert_eq!(status(&target).unwrap(), LinkStatus::Packaged(packaged));
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn another_apps_registration_is_left_alone() {
            let root = temp_root("not-ours");
            let target = target(&root);
            let mimeapps = root.join("config/mimeapps.list");
            std::fs::create_dir_all(mimeapps.parent().unwrap()).unwrap();
            let other = "[Default Applications]\nx-scheme-handler/semaphore=electron.desktop\n";
            std::fs::write(&mimeapps, other).unwrap();
            assert_eq!(
                status(&target).unwrap(),
                LinkStatus::Another("electron.desktop".into())
            );
            assert_eq!(unregister(&target).unwrap(), Unregistered::NotOurs);
            assert_eq!(std::fs::read_to_string(&mimeapps).unwrap(), other);
            std::fs::remove_dir_all(&root).unwrap();
        }

        #[test]
        fn a_packages_registration_is_not_removed_and_a_users_entry_stays() {
            let root = temp_root("package-remove");
            let links = target(&root);
            let packaged = root.join("system/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(packaged.parent().unwrap()).unwrap();
            std::fs::write(&packaged, "[Desktop Entry]\n").unwrap();
            assert_eq!(
                unregister(&links).unwrap(),
                Unregistered::Packaged(packaged.clone())
            );
            assert!(packaged.is_file());
            std::fs::remove_dir_all(&root).unwrap();

            // Our id, but written by the user: their entry stays, and `status` doesn't call the
            // registration ours, so unregistering touches nothing.
            let root = temp_root("foreign-remove");
            let links = target(&root);
            let entry = root.join("data/applications/app.semaphorechat.semaphore.desktop");
            std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
            std::fs::write(&entry, "[Desktop Entry]\nExec=mine %u\n").unwrap();
            std::fs::create_dir_all(root.join("config")).unwrap();
            std::fs::write(
                root.join("config/mimeapps.list"),
                "[Default Applications]\nx-scheme-handler/semaphore=app.semaphorechat.semaphore.desktop\n",
            )
            .unwrap();
            assert!(matches!(status(&links).unwrap(), LinkStatus::Another(_)));
            assert_eq!(unregister(&links).unwrap(), Unregistered::NotOurs);
            assert!(entry.is_file());
            std::fs::remove_dir_all(&root).unwrap();
        }
    }
}
