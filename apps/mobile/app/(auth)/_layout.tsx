/**
 * GigaPDF Auth Layout
 * Layout for authentication screens (login, register, forgot password)
 * No tabs, clean minimal navigation with theme support
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../../src/contexts/ThemeContext';

export default function AuthLayout() {
  const { theme, colors } = useTheme();

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: {
            backgroundColor: colors.background,
          },
          gestureEnabled: true,
          gestureDirection: 'horizontal',
        }}
      >
        <Stack.Screen
          name="login"
          options={{
            title: 'Connexion',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="register"
          options={{
            title: 'Inscription',
            headerShown: false,
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="forgot-password"
          options={{
            title: 'Mot de passe oublie',
            headerShown: false,
            animation: 'slide_from_bottom',
          }}
        />
      </Stack>
    </>
  );
}
