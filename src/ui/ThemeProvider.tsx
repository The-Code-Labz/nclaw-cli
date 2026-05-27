import fs from 'fs';
import os from 'os';
import path from 'path';
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ThemePreset, ThemeColors } from './themes/presets';
import { THEMES, defaultTheme } from './themes/presets';

const PREFS_DIR  = path.join(os.homedir(), '.nclaw');
const PREFS_PATH = path.join(PREFS_DIR, 'preferences.json');

function ensureDir(): void {
  try {
    fs.mkdirSync(PREFS_DIR, { recursive: true, mode: 0o700 });
  } catch { /* ignore */ }
}

function loadSavedTheme(): ThemePreset {
  try {
    const raw = fs.readFileSync(PREFS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { themeName?: string };
    const found = THEMES.find(t => t.name === parsed.themeName);
    return found ?? defaultTheme;
  } catch {
    return defaultTheme;
  }
}

function saveThemeName(name: string): void {
  ensureDir();
  try {
    fs.writeFileSync(PREFS_PATH, JSON.stringify({ themeName: name }, null, 2), { mode: 0o600 });
  } catch {
    fs.writeFileSync(PREFS_PATH, JSON.stringify({ themeName: name }, null, 2));
  }
}

interface ThemeContextValue {
  theme:    ThemePreset;
  colors:   ThemeColors;
  setTheme: (preset: ThemePreset) => void;
  cycle:    () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreset>(loadSavedTheme);

  const setTheme = useCallback((preset: ThemePreset) => {
    setThemeState(preset);
    saveThemeName(preset.name);
  }, []);

  const cycle = useCallback(() => {
    const idx = THEMES.findIndex(t => t.name === theme.name);
    const next = THEMES[(idx + 1) % THEMES.length] ?? defaultTheme;
    setTheme(next);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, colors: theme.colors, setTheme, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}
