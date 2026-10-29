/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { FLAGS, readFlag, writeFlag } from '../../store/storage';

export type ThemeMode = 'dark' | 'light';
export type AccentId = 'laranja' | 'azul' | 'esmeralda' | 'rosa' | 'violeta' | 'grafite';

/** Cor de destaque por tema: [principal, fim do gradiente]. Espelha os tokens do index.css. */
export const ACCENTS: Record<AccentId, { label: string; dark: [string, string]; light: [string, string] }> = {
  laranja: { label: 'Laranja', dark: ['#ff8a3d', '#f9573a'], light: ['#ea6a12', '#e2462a'] },
  azul: { label: 'Azul', dark: ['#4f8dff', '#3b5bff'], light: ['#2563eb', '#1d4ed8'] },
  esmeralda: { label: 'Esmeralda', dark: ['#22c59a', '#0ea5a4'], light: ['#059669', '#0d9488'] },
  rosa: { label: 'Rosa', dark: ['#f2618f', '#d9468d'], light: ['#db2777', '#be185d'] },
  violeta: { label: 'Violeta', dark: ['#8b7cff', '#a66bff'], light: ['#5b5bd6', '#7c4ddb'] },
  grafite: { label: 'Grafite', dark: ['#e5e7eb', '#a1a1aa'], light: ['#1f2937', '#475569'] },
};

interface ThemeContextValue {
  theme: ThemeMode;
  accent: AccentId;
  toggleTheme: () => void;
  setAccent: (accent: AccentId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const initialTheme = (): ThemeMode => {
  const saved = readFlag(FLAGS.theme);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const initialAccent = (): AccentId => {
  const saved = readFlag(FLAGS.accent) as AccentId | null;
  return saved && saved in ACCENTS ? saved : 'laranja';
};

// Ícone da aba: cartão sobre um quadrado com o gradiente da cor de destaque.
const faviconSvg = (from: string, to: string, ink: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#g)"/>
<rect x="12" y="18" width="40" height="28" rx="6" fill="none" stroke="${ink}" stroke-width="4"/>
<path d="M12 27h40" stroke="${ink}" stroke-width="5"/>
<rect x="18" y="35" width="11" height="4.5" rx="2.2" fill="${ink}"/>
</svg>`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [accent, setAccentState] = useState<AccentId>(initialAccent);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0e11' : '#f4f5f7');
    // No APK a página fica por baixo da barra de status: os ícones dela seguem o tema do app, não o do celular.
    if (Capacitor.isNativePlatform()) {
      SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
    }
    const [from, to] = ACCENTS[accent].dark;
    const ink = accent === 'grafite' ? '#111318' : '#ffffff';
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(from, to, ink))}`;
  }, [theme, accent]);

  const toggleTheme = useCallback(() => {
    setTheme(previous => {
      const next = previous === 'dark' ? 'light' : 'dark';
      writeFlag(FLAGS.theme, next);
      return next;
    });
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    writeFlag(FLAGS.accent, next);
  }, []);

  const value = useMemo(() => ({ theme, accent, toggleTheme, setAccent }), [theme, accent, toggleTheme, setAccent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
