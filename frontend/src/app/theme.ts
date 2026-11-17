export type Theme = 'light' | 'dark';
const storageKey = 'interface-theme';
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Выбор темы работает и при недоступном хранилище браузера. */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem(storageKey, theme); } catch { /* Сохраняем тему до перезагрузки. */ }
  }
}
