import type { AppearancePreferences } from '../../shared';

const DARK_SCHEME = '(prefers-color-scheme: dark)';

export function applyTheme(theme: AppearancePreferences['theme'], media = window.matchMedia(DARK_SCHEME)): void {
  document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
}

export function watchTheme(theme: AppearancePreferences['theme']): () => void {
  const media = window.matchMedia(DARK_SCHEME);
  function update() {
    applyTheme(theme, media);
  }
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
