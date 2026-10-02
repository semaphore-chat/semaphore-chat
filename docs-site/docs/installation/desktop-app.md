# Desktop App

Semaphore Chat provides an Electron-based desktop app for Windows and Linux with native features like system tray integration, auto-updates, and enhanced screen sharing.

## Download

Download the latest release for your platform from **[GitHub Releases](https://github.com/semaphore-chat/semaphore-chat/releases)**.

| Platform | Format | File |
|----------|--------|------|
| **Windows** | NSIS installer | `SemaphoreChat-Setup-X.X.X.exe` |
| **Linux** | Universal binary | `SemaphoreChat-X.X.X.AppImage` |
| **Linux** | Debian/Ubuntu | `semaphore-chat_X.X.X_amd64.deb` |
| **Linux** | Fedora/RHEL | `semaphore-chat-X.X.X.x86_64.rpm` |

!!! note "macOS"
    macOS builds are not yet available. macOS support is planned for a future release.

## Install

=== "Windows"

    1. Download `SemaphoreChat-Setup-X.X.X.exe` from [Releases](https://github.com/semaphore-chat/semaphore-chat/releases)
    2. Run the installer — you can choose the install directory
    3. Launch Semaphore Chat from the Start Menu or desktop shortcut

=== "Linux (AppImage)"

    1. Download `SemaphoreChat-X.X.X.AppImage` from [Releases](https://github.com/semaphore-chat/semaphore-chat/releases)
    2. Make it executable and run:
        ```bash
        chmod +x SemaphoreChat-*.AppImage
        ./SemaphoreChat-*.AppImage
        ```

=== "Linux (Debian/Ubuntu)"

    ```bash
    sudo dpkg -i semaphore-chat_*_amd64.deb
    sudo apt-get install -f  # resolve any missing dependencies
    ```

=== "Linux (Fedora/RHEL)"

    ```bash
    sudo rpm -i semaphore-chat-*.x86_64.rpm
    ```

## Connect to your instance

On first launch, Semaphore Chat will prompt you to enter your server URL (e.g. `https://semaphore-chat.example.com`). This is the address where your self-hosted Semaphore Chat instance is running.

## Auto-updates

The desktop app checks for updates automatically on startup and periodically while running. When a new version is available, you'll see a notification with the option to install and restart.

Updates are served from GitHub Releases — no additional infrastructure required.

On Linux, the AppImage replaces itself. The .deb and .rpm installs run the package manager as root, through `pkexec` (you'll see your desktop's password prompt) or, without pkexec, `sudo`.

!!! warning "Linux .deb/.rpm: when the update doesn't install"
    - **Version 0.4.2 or 0.4.3:** auto-update can't install the next version on these two releases (the update fails with `Command pkexec exited with code 1`). Download the new package from [Releases](https://github.com/semaphore-chat/semaphore-chat/releases) and install it by hand once, as above. Versions from 0.5.0 on update normally.
    - **`Command pkexec exited with code 127`:** pkexec couldn't ask for your password, usually because no polkit authentication agent is running (common with minimal window managers). Start one (for example `polkit-gnome` or `lxpolkit`) and retry, or install the new package by hand.

## Saved sign-in and your keyring

The desktop app keeps your session (a refresh token) encrypted with the operating system's credential storage: DPAPI on Windows, and on Linux a keyring: a Secret Service such as GNOME Keyring or KeePassXC, or KWallet.

On Linux, Electron's underlying Chromium picks the keyring from your desktop environment (`XDG_CURRENT_DESKTOP`): GNOME, Unity, XFCE, Cinnamon, Pantheon, Deepin, UKUI and COSMIC use the Secret Service, KDE uses KWallet. On a desktop it doesn't recognise, such as Hyprland, Sway, i3 or other window managers, it would store the token unencrypted. Semaphore Chat handles that case itself: if a Secret Service (`org.freedesktop.secrets`) is running or can be started on your session D-Bus, the app uses it. If no keyring is available, the token is stored unencrypted and the app shows a one-time warning: *"Secure credential storage is unavailable on this system"*.

If you were signed in while the token was stored unencrypted, you stay signed in once a keyring becomes available: the app reads the old token and moves the session into the keyring the next time it refreshes.

!!! tip "Choosing the keyring by hand"
    To override the automatic choice (for example if the warning still appears while a keyring is running, or to use KWallet), launch the app with Chromium's `--password-store` switch:

    ```bash
    ./SemaphoreChat-*.AppImage --password-store=gnome-libsecret   # Secret Service (GNOME Keyring, KeePassXC, ...)
    semaphore-chat --password-store=kwallet6                       # KWallet on Plasma 6 (kwallet5 on Plasma 5)
    ```

    Add it to the `Exec=` line of the app's `.desktop` file to make it permanent. When you pass `--password-store` yourself, the app doesn't change it.

## Deep links

The desktop app registers the `semaphore://` URL scheme, so links can open the app directly to a specific community, channel, direct message, or invite instead of your browser:

| Link form | Opens |
|-----------|-------|
| `semaphore://community/<communityId>` | A community |
| `semaphore://community/<communityId>/channel/<channelId>` | A specific channel |
| `semaphore://direct-messages` | Your direct messages inbox |
| `semaphore://direct-messages/<dmGroupId>` | A specific DM/group DM |
| `semaphore://join/<inviteCode>` | An invite (works even if you're signed out — you'll be prompted to sign in or register, then join) |

If you're signed out when you click a community, channel, or DM link, the app takes you to sign-in first and opens the link automatically once you're signed in.

!!! note "Links open in your active server"
    Semaphore Chat's desktop app can be connected to multiple self-hosted instances. Deep links don't encode which server they belong to — they always open within whichever server is currently active. If a link is meant for a different server than the one you have active, switch servers first.

## Desktop-only features

The desktop app includes capabilities not available in the browser:

- **Screen source picker** — choose specific windows or monitors to share (on X11)
- **System audio capture** — share desktop audio during screen sharing (Windows)
- **System tray** — minimize to tray, quick access controls
- **Auto-start** — optionally launch Semaphore Chat on system startup
- **Native notifications** — OS-level notification integration
