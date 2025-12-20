/**
 * GigaPDF Color Palette
 * Consistent colors for light and dark themes
 */

export const Colors = {
  light: {
    // Primary colors
    primary: '#2563EB',
    primaryLight: '#3B82F6',
    primaryDark: '#1D4ED8',

    // Background colors
    background: '#FFFFFF',
    backgroundSecondary: '#F8FAFC',
    backgroundTertiary: '#F1F5F9',

    // Surface colors
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',

    // Text colors
    text: '#0F172A',
    textSecondary: '#475569',
    textTertiary: '#94A3B8',
    textInverse: '#FFFFFF',

    // Border colors
    border: '#E2E8F0',
    borderLight: '#F1F5F9',

    // Status colors
    success: '#10B981',
    successLight: '#D1FAE5',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    error: '#EF4444',
    errorLight: '#FEE2E2',
    info: '#3B82F6',
    infoLight: '#DBEAFE',

    // Tab bar
    tabBar: '#FFFFFF',
    tabBarBorder: '#E2E8F0',
    tabIconDefault: '#94A3B8',
    tabIconSelected: '#2563EB',

    // Cards
    card: '#FFFFFF',
    cardBorder: '#E2E8F0',

    // Overlay
    overlay: 'rgba(15, 23, 42, 0.5)',

    // Shadow
    shadow: 'rgba(0, 0, 0, 0.1)',
  },

  dark: {
    // Primary colors
    primary: '#3B82F6',
    primaryLight: '#60A5FA',
    primaryDark: '#2563EB',

    // Background colors
    background: '#0F172A',
    backgroundSecondary: '#1E293B',
    backgroundTertiary: '#334155',

    // Surface colors
    surface: '#1E293B',
    surfaceElevated: '#334155',

    // Text colors
    text: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textTertiary: '#64748B',
    textInverse: '#0F172A',

    // Border colors
    border: '#334155',
    borderLight: '#1E293B',

    // Status colors
    success: '#34D399',
    successLight: '#064E3B',
    warning: '#FBBF24',
    warningLight: '#78350F',
    error: '#F87171',
    errorLight: '#7F1D1D',
    info: '#60A5FA',
    infoLight: '#1E3A8A',

    // Tab bar
    tabBar: '#1E293B',
    tabBarBorder: '#334155',
    tabIconDefault: '#64748B',
    tabIconSelected: '#3B82F6',

    // Cards
    card: '#1E293B',
    cardBorder: '#334155',

    // Overlay
    overlay: 'rgba(0, 0, 0, 0.7)',

    // Shadow
    shadow: 'rgba(0, 0, 0, 0.3)',
  },
};

export type ThemeColors = typeof Colors.light;
