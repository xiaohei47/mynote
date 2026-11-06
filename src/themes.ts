export type ThemeName = 'one-dark' | 'light' | 'nord';
export const themes = {
  'one-dark': {
    label: 'One Dark', dark: true,
    colors: { bg: '#282c34', panel: '#21252b', card: '#2c313a', border: '#3e4451', text: '#abb2bf', heading: '#e6e9ef', muted: '#939aa7', primary: '#61afef', hover: '#323842', selected: '#313e50', link: '#61afef' },
  },
  light: {
    label: '浅色', dark: false,
    colors: { bg: '#f5f5ef', panel: '#eff1e9', card: '#ffffff', border: '#d9dfd2', text: '#41543f', heading: '#294234', muted: '#7e8c77', primary: '#315f48', hover: '#eaf0e3', selected: '#e5eddf', link: '#356d50' },
  },
  nord: {
    label: 'Nord', dark: true,
    colors: { bg: '#2e3440', panel: '#272d38', card: '#353d4b', border: '#4c566a', text: '#d8dee9', heading: '#eceff4', muted: '#a0aec0', primary: '#88c0d0', hover: '#3b4252', selected: '#434f63', link: '#8fbcbb' },
  },
};
export function readTheme(): ThemeName {
  try { const saved = localStorage.getItem('shiye-theme'); if (saved === 'one-dark' || saved === 'light' || saved === 'nord') return saved; } catch {}
  return 'one-dark';
}
export function applyTheme(name: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = name;
  root.style.colorScheme = themes[name].dark ? 'dark' : 'light';
  for (const [key, value] of Object.entries(themes[name].colors)) root.style.setProperty(`--${key}`, value);
  try { localStorage.setItem('shiye-theme', name); } catch {}
}
