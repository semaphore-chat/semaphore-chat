/**
 * App Settings Store
 *
 * Simple JSON-based settings persistence in userData/settings.json.
 * Follows the same pattern as window-state.json persistence in main.ts.
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface AppSettings {
  closeToTray: boolean;
}

const defaults: AppSettings = {
  closeToTray: true,
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(data);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  const settings = loadSettings();
  return settings[key];
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}
