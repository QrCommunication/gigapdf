/**
 * i18n Configuration
 * Configuration d'internationalisation pour GigaPDF
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en';
import fr from './locales/fr';
import es from './locales/es';
import de from './locales/de';

const LANGUAGE_STORAGE_KEY = '@gigapdf_language';

// Ressources de traduction
const resources = {
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
  de: { translation: de },
};

// Langues supportées
export const supportedLanguages = ['en', 'fr', 'es', 'de'] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

// Configuration i18n
i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    lng: undefined, // Sera défini après le chargement

    interpolation: {
      escapeValue: false, // React gère déjà l'échappement
    },

    react: {
      useSuspense: false,
    },
  });

/**
 * Initialise la langue de l'utilisateur
 */
export const initializeLanguage = async () => {
  try {
    // Essayer de charger la langue sauvegardée
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);

    if (savedLanguage && supportedLanguages.includes(savedLanguage as SupportedLanguage)) {
      await i18n.changeLanguage(savedLanguage);
      return;
    }

    // Sinon, utiliser la langue du système
    const deviceLanguage = Localization.getLocales()[0]?.languageCode || 'en';
    const language = supportedLanguages.includes(deviceLanguage as SupportedLanguage)
      ? deviceLanguage
      : 'en';

    await i18n.changeLanguage(language);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (error) {
    console.error('Error initializing language:', error);
    await i18n.changeLanguage('en');
  }
};

/**
 * Change la langue de l'application
 */
export const changeLanguage = async (language: SupportedLanguage) => {
  try {
    await i18n.changeLanguage(language);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (error) {
    console.error('Error changing language:', error);
  }
};

/**
 * Obtenir la langue actuelle
 */
export const getCurrentLanguage = (): SupportedLanguage => {
  return i18n.language as SupportedLanguage;
};

export default i18n;
