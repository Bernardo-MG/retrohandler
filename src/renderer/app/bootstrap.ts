import { defaultSettings, type SettingsSnapshot } from '../../shared';
import { desktopApi } from '../api/desktop-api';
import { applyTheme } from './theme';

export async function initializeApplication(): Promise<SettingsSnapshot> {
  let initial: SettingsSnapshot;
  try {
    initial = await desktopApi().getSettings();
  } catch (reason) {
    initial = {
      settings: defaultSettings(),
      warning: `Could not load application preferences: ${String(reason)}`
    };
  }
  // Apply the initial theme before React mounts.
  applyTheme(initial.settings.appearance.theme);
  return initial;
}
