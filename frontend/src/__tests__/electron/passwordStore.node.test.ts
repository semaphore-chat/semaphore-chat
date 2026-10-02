// @vitest-environment node
/**
 * Linux password-store selection for safeStorage (#549): when to ask Chromium
 * for `--password-store=gnome-libsecret`, and the Secret Service probe.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chromiumUsesBasicStore,
  choosePasswordStore,
  probeSecretService,
  type DbusSend,
  type PasswordStoreInput,
} from '../../../electron/passwordStore';

describe('chromiumUsesBasicStore (mirrors Chromium desktop -> backend mapping)', () => {
  it.each([
    'GNOME',
    'ubuntu:GNOME',
    'Unity',
    'XFCE',
    'X-Cinnamon',
    'Pantheon',
    'Deepin',
    'UKUI',
    'COSMIC',
    'KDE',
    'Hyprland:GNOME',
  ])('XDG_CURRENT_DESKTOP=%s has a keyring backend', (desktop) => {
    expect(chromiumUsesBasicStore({ XDG_CURRENT_DESKTOP: desktop })).toBe(false);
  });

  it.each(['Hyprland', 'sway', 'i3', 'niri', 'LXQt', 'MATE', 'gnome', '', 'LXQt:GNOME'])(
    'XDG_CURRENT_DESKTOP=%j falls back to basic',
    (desktop) => {
      expect(chromiumUsesBasicStore({ XDG_CURRENT_DESKTOP: desktop })).toBe(true);
    },
  );

  it('falls back to basic with no desktop variables at all', () => {
    expect(chromiumUsesBasicStore({})).toBe(true);
  });

  it.each([
    [{ DESKTOP_SESSION: 'gnome' }, false],
    [{ DESKTOP_SESSION: 'mate' }, false],
    [{ DESKTOP_SESSION: 'xubuntu' }, false],
    [{ DESKTOP_SESSION: 'xfce4' }, false],
    [{ DESKTOP_SESSION: 'kde-plasma' }, false],
    [{ DESKTOP_SESSION: 'kde', KDE_SESSION_VERSION: '5' }, false],
    [{ DESKTOP_SESSION: 'kde' }, true],
    [{ DESKTOP_SESSION: 'hyprland' }, true],
    [{ GNOME_DESKTOP_SESSION_ID: 'this-is-deprecated' }, false],
    [{ KDE_FULL_SESSION: 'true', KDE_SESSION_VERSION: '6' }, false],
    [{ KDE_FULL_SESSION: 'true' }, true],
    [{ XDG_CURRENT_DESKTOP: 'Hyprland', DESKTOP_SESSION: 'gnome' }, false],
  ])('fallback variables %j -> basic=%s', (env, basic) => {
    expect(chromiumUsesBasicStore(env)).toBe(basic);
  });
});

describe('choosePasswordStore', () => {
  const linux = (overrides: Partial<PasswordStoreInput> = {}): PasswordStoreInput => ({
    platform: 'linux',
    env: { XDG_CURRENT_DESKTOP: 'Hyprland' },
    hasUserPasswordStore: false,
    probeSecretService: () => true,
    ...overrides,
  });

  it('asks for libsecret on an unknown desktop with a Secret Service', () => {
    expect(choosePasswordStore(linux()).passwordStore).toBe('gnome-libsecret');
  });

  it.each(['darwin', 'win32'] as const)('leaves %s alone without probing', (platform) => {
    const probe = vi.fn(() => true);
    expect(choosePasswordStore(linux({ platform, probeSecretService: probe })).passwordStore).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('respects an explicit --password-store from the user', () => {
    const probe = vi.fn(() => true);
    const decision = choosePasswordStore(linux({ hasUserPasswordStore: true, probeSecretService: probe }));
    expect(decision.passwordStore).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it.each(['GNOME', 'KDE', 'XFCE'])('leaves Chromium\'s keyring choice on %s', (desktop) => {
    const probe = vi.fn(() => true);
    const decision = choosePasswordStore(
      linux({ env: { XDG_CURRENT_DESKTOP: desktop }, probeSecretService: probe }),
    );
    expect(decision.passwordStore).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('stays on basic when no Secret Service is on the bus', () => {
    expect(choosePasswordStore(linux({ probeSecretService: () => false })).passwordStore).toBeNull();
  });

  it('stays on basic when the bus cannot be queried', () => {
    const decision = choosePasswordStore(linux({ probeSecretService: () => null }));
    expect(decision.passwordStore).toBeNull();
    expect(decision.reason).toMatch(/could not query/);
  });
});

describe('probeSecretService', () => {
  const env = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };
  const reply = (body: string) => `method return time=1 sender=org.freedesktop.DBus -> destination=:1.1\n   ${body}\n`;

  it('is true when org.freedesktop.secrets has an owner', () => {
    const send = vi.fn<DbusSend>(() => reply('boolean true'));
    expect(probeSecretService(env, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual(expect.arrayContaining([
      '--session',
      'org.freedesktop.DBus.NameHasOwner',
      'string:org.freedesktop.secrets',
    ]));
  });

  it('is true when org.freedesktop.secrets is D-Bus activatable', () => {
    const send = vi.fn<DbusSend>()
      .mockReturnValueOnce(reply('boolean false'))
      .mockReturnValueOnce(reply('array [\n      string "org.freedesktop.DBus"\n      string "org.freedesktop.secrets"\n   ]'));
    expect(probeSecretService(env, send)).toBe(true);
    expect(send.mock.calls[1][0]).toContain('org.freedesktop.DBus.ListActivatableNames');
  });

  it('is false when the name is neither owned nor activatable', () => {
    const send = vi.fn<DbusSend>()
      .mockReturnValueOnce(reply('boolean false'))
      .mockReturnValueOnce(reply('array [\n      string "org.freedesktop.DBus"\n   ]'));
    expect(probeSecretService(env, send)).toBe(false);
  });

  it('is null when dbus-send fails (missing, error, timeout)', () => {
    expect(probeSecretService(env, () => null)).toBeNull();
  });

  it('is null without a session bus, and does not run dbus-send', () => {
    const send = vi.fn<DbusSend>(() => reply('boolean true'));
    expect(probeSecretService({}, send, () => false)).toBeNull();
    expect(probeSecretService({ XDG_RUNTIME_DIR: '/run/user/1000' }, send, () => false)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses the systemd user bus socket when DBUS_SESSION_BUS_ADDRESS is unset', () => {
    const exists = vi.fn(() => true);
    expect(probeSecretService({ XDG_RUNTIME_DIR: '/run/user/1000' }, () => reply('boolean true'), exists)).toBe(true);
    expect(exists).toHaveBeenCalledWith('/run/user/1000/bus');
  });

  describe('with the real dbus-send runner (a fake dbus-send on PATH)', () => {
    let dir: string;
    let savedPath: string | undefined;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'dbus-send-'));
      savedPath = process.env.PATH;
      process.env.PATH = `${dir}:${savedPath ?? ''}`;
    });
    afterEach(() => {
      process.env.PATH = savedPath;
      rmSync(dir, { recursive: true, force: true });
    });

    const fakeDbusSend = (script: string) => {
      const file = path.join(dir, 'dbus-send');
      writeFileSync(file, `#!/bin/sh\n${script}\n`);
      chmodSync(file, 0o755);
    };

    it('reads a NameHasOwner reply', () => {
      fakeDbusSend('echo "method return"; echo "   boolean true"');
      expect(probeSecretService(env)).toBe(true);
    });

    it('treats a non-zero exit as unknown', () => {
      fakeDbusSend('echo "Error org.freedesktop.DBus.Error.NoReply" >&2; exit 1');
      expect(probeSecretService(env)).toBeNull();
    });

    it('gives up on a hung dbus-send', () => {
      fakeDbusSend('exec sleep 10');
      const start = Date.now();
      expect(probeSecretService(env)).toBeNull();
      expect(Date.now() - start).toBeLessThan(5000);
    });

    it('treats a missing dbus-send as unknown', () => {
      process.env.PATH = dir; // empty dir: no dbus-send
      expect(probeSecretService(env)).toBeNull();
    });
  });
});
