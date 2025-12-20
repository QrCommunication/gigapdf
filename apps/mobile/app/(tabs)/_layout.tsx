/**
 * Tabs Layout
 * Bottom tab navigation for main screens with safe area support
 */

import React from 'react';
import { StyleSheet, Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/contexts/ThemeContext';
import { IconSizes, Typography } from '../../src/constants/spacing';

type TabBarIconProps = {
  focused: boolean;
  color: string;
  size: number;
};

export default function TabsLayout() {
  const { theme, colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Calculate proper tab bar height with safe area
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.background,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTitleStyle: {
          fontSize: Typography.lg,
          fontWeight: Typography.semibold,
          color: colors.text,
        },
        headerTintColor: colors.primary,
        tabBarActiveTintColor: colors.tabIconSelected,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          height: tabBarHeight,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontSize: Typography.xs,
          fontWeight: Typography.medium,
          marginTop: 4,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Documents',
          headerTitle: 'Mes Documents',
          tabBarIcon: ({ focused, color }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'document-text' : 'document-text-outline'}
              size={IconSizes.md}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          title: 'Outils',
          headerTitle: 'Outils PDF',
          tabBarIcon: ({ focused, color }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'construct' : 'construct-outline'}
              size={IconSizes.md}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Parametres',
          headerTitle: 'Parametres',
          tabBarIcon: ({ focused, color }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={IconSizes.md}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
