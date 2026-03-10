/**
 * Theme Context for GigaPDF
 * Provides theme switching between light and dark modes
 * Integrates with settingsStore for persistence
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { Colors, ThemeColors } from '../constants/colors';
import { useSettingsStore } from '../stores/settingsStore';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: 'light' | 'dark';
  themeMode: ThemeMode;
  colors: ThemeColors;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const { theme: storedTheme, setTheme } = useSettingsStore();

  // Convert 'auto' to 'system' for consistency
  const themeMode: ThemeMode = storedTheme === 'auto' ? 'system' : storedTheme;

  const theme: 'light' | 'dark' = useMemo(() => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark' ? 'dark' : 'light';
    }
    return themeMode;
  }, [themeMode, systemColorScheme]);

  const colors = useMemo(() => Colors[theme], [theme]);

  const setThemeMode = async (mode: ThemeMode) => {
    // Convert 'system' back to 'auto' for storage
    const storageMode = mode === 'system' ? 'auto' : mode;
    await setTheme(storageMode as 'light' | 'dark' | 'auto');
  };

  const toggleTheme = async () => {
    if (themeMode === 'system') {
      await setThemeMode(theme === 'light' ? 'dark' : 'light');
    } else {
      await setThemeMode(themeMode === 'light' ? 'dark' : 'light');
    }
  };

  const value = useMemo(
    () => ({
      theme,
      themeMode,
      colors,
      setThemeMode,
      toggleTheme,
    }),
    [theme, themeMode, colors]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
