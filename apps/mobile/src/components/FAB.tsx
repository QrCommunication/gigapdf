/**
 * Floating Action Button Component
 */

import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  Animated,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { Spacing, IconSizes } from '../constants/spacing';
import { IconName } from '../types/tools';

interface FABProps {
  icon: IconName;
  onPress: () => void;
  style?: ViewStyle;
  size?: 'small' | 'medium' | 'large';
}

// Tab bar height constant (56 base + padding)
const TAB_BAR_HEIGHT = 56 + 8;

export function FAB({
  icon,
  onPress,
  style,
  size = 'medium',
}: FABProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scale = React.useRef(new Animated.Value(1)).current;

  // Calculate bottom position: tab bar height + safe area + margin
  const bottomPosition = TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) + Spacing.md;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const sizeStyles = {
    small: { width: 48, height: 48, iconSize: IconSizes.sm },
    medium: { width: 56, height: 56, iconSize: IconSizes.md },
    large: { width: 64, height: 64, iconSize: IconSizes.lg },
  };

  const currentSize = sizeStyles[size];

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: currentSize.width,
          height: currentSize.height,
          borderRadius: currentSize.width / 2,
          backgroundColor: colors.primary,
          shadowColor: colors.shadow,
          transform: [{ scale }],
          bottom: bottomPosition,
        },
        style,
      ]}
    >
      <TouchableOpacity
        style={styles.button}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <Ionicons
          name={icon}
          size={currentSize.iconSize}
          color={colors.textInverse}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: Spacing.screenPadding,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  button: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
