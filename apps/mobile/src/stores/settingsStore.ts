/**
 * Settings Store
 * Zustand store pour gérer les paramètres de l'application
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { changeLanguage, type SupportedLanguage } from '../i18n/i18n.config';

type ThemeMode = 'light' | 'dark' | 'auto';
type DefaultQuality = 'low' | 'medium' | 'high';

interface SettingsState {
  // État
  language: SupportedLanguage;
  theme: ThemeMode;
  notificationsEnabled: boolean;
  autoSave: boolean;
  defaultQuality: DefaultQuality;
  isLoading: boolean;

  // Actions
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setAutoSave: (enabled: boolean) => Promise<void>;
  setDefaultQuality: (quality: DefaultQuality) => Promise<void>;
  loadSettings: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const SETTINGS_KEYS = {
  LANGUAGE: '@settings_language',
  THEME: '@settings_theme',
  NOTIFICATIONS: '@settings_notifications',
  AUTO_SAVE: '@settings_auto_save',
  DEFAULT_QUALITY: '@settings_default_quality',
};

const DEFAULT_SETTINGS = {
  language: 'en' as SupportedLanguage,
  theme: 'auto' as ThemeMode,
  notificationsEnabled: true,
  autoSave: true,
  defaultQuality: 'medium' as DefaultQuality,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  // État initial
  ...DEFAULT_SETTINGS,
  isLoading: false,

  // Set language
  setLanguage: async (language: SupportedLanguage) => {
    try {
      await changeLanguage(language);
      await AsyncStorage.setItem(SETTINGS_KEYS.LANGUAGE, language);
      set({ language });
    } catch (error) {
      console.error('Error saving language:', error);
    }
  },

  // Set theme
  setTheme: async (theme: ThemeMode) => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.THEME, theme);
      set({ theme });
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  },

  // Set notifications enabled
  setNotificationsEnabled: async (enabled: boolean) => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.NOTIFICATIONS, String(enabled));
      set({ notificationsEnabled: enabled });
    } catch (error) {
      console.error('Error saving notifications setting:', error);
    }
  },

  // Set auto save
  setAutoSave: async (enabled: boolean) => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.AUTO_SAVE, String(enabled));
      set({ autoSave: enabled });
    } catch (error) {
      console.error('Error saving auto save setting:', error);
    }
  },

  // Set default quality
  setDefaultQuality: async (quality: DefaultQuality) => {
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.DEFAULT_QUALITY, quality);
      set({ defaultQuality: quality });
    } catch (error) {
      console.error('Error saving default quality:', error);
    }
  },

  // Load settings from storage
  loadSettings: async () => {
    try {
      set({ isLoading: true });

      const [language, theme, notifications, autoSave, defaultQuality] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEYS.LANGUAGE),
        AsyncStorage.getItem(SETTINGS_KEYS.THEME),
        AsyncStorage.getItem(SETTINGS_KEYS.NOTIFICATIONS),
        AsyncStorage.getItem(SETTINGS_KEYS.AUTO_SAVE),
        AsyncStorage.getItem(SETTINGS_KEYS.DEFAULT_QUALITY),
      ]);

      set({
        language: (language as SupportedLanguage) || DEFAULT_SETTINGS.language,
        theme: (theme as ThemeMode) || DEFAULT_SETTINGS.theme,
        notificationsEnabled: notifications !== null ? notifications === 'true' : DEFAULT_SETTINGS.notificationsEnabled,
        autoSave: autoSave !== null ? autoSave === 'true' : DEFAULT_SETTINGS.autoSave,
        defaultQuality: (defaultQuality as DefaultQuality) || DEFAULT_SETTINGS.defaultQuality,
        isLoading: false,
      });

      // Apply language if needed
      if (language) {
        await changeLanguage(language as SupportedLanguage);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      set({ isLoading: false });
    }
  },

  // Reset settings to defaults
  resetSettings: async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(SETTINGS_KEYS.LANGUAGE),
        AsyncStorage.removeItem(SETTINGS_KEYS.THEME),
        AsyncStorage.removeItem(SETTINGS_KEYS.NOTIFICATIONS),
        AsyncStorage.removeItem(SETTINGS_KEYS.AUTO_SAVE),
        AsyncStorage.removeItem(SETTINGS_KEYS.DEFAULT_QUALITY),
      ]);

      set(DEFAULT_SETTINGS);
      await changeLanguage(DEFAULT_SETTINGS.language);
    } catch (error) {
      console.error('Error resetting settings:', error);
    }
  },
}));
