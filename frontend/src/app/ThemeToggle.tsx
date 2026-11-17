import { useState } from 'react';
import { applyTheme, initialTheme } from './theme';
export function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  return <button type="button" className="theme-toggle" aria-label="Тёмная тема" aria-pressed={theme === 'dark'}
    title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} onClick={() => {
      const next = theme === 'dark' ? 'light' : 'dark';
      setTheme(next); applyTheme(next, true);
    }}><span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span> {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button>;
}
