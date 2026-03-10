/**
 * Settings Item Component
 * Individual setting row with icon and action
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Spacing, Typography, IconSizes } from '../constants/spacing';
import { IconName } from '../types/tools';

interface SettingsItemProps {
  icon: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  showChevron?: boolean;
  showSwitch?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
  onPress?: () => void;
  danger?: boolean;
}

export function SettingsItem({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  showChevron = true,
  showSwitch = false,
  switchValue = false,
  onSwitchChange,
  onPress,
  danger = false,
}: SettingsItemProps) {
  const { colors } = useTheme();

  const textColor = danger ? colors.error : colors.text;
  const actualIconColor = iconColor || (danger ? colors.error : colors.primary);

  const content = (
    <View
      style={[
        styles.container,
        { borderBottomColor: colors.border },
      ]}
    >
      {/* Icon */}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: danger
              ? colors.errorLight
              : `${actualIconColor}15`,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={IconSizes.sm}
          color={actualIconColor}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>

      {/* Right side */}
      {value && (
        <Text style={[styles.value, { color: colors.textSecondary }]}>
          {value}
        </Text>
      )}
      {showSwitch && (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{
            false: colors.border,
            true: colors.primaryLight,
          }}
          thumbColor={switchValue ? colors.primary : colors.textTertiary}
        />
      )}
      {showChevron && !showSwitch && (
        <Ionicons
          name="chevron-forward"
          size={IconSizes.sm}
          color={colors.textTertiary}
        />
      )}
    </View>
  );

  if (onPress && !showSwitch) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

interface SettingsSectionProps {
  title?: string;
  children: React.ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      {title && (
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {title}
        </Text>
      )}
      <View
        style={[
          styles.sectionContent,
          {
            backgroundColor: colors.card,
            borderColor: colors.cardBorder,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginHorizontal: Spacing.screenPadding,
  },
  sectionContent: {
    marginHorizontal: Spacing.screenPadding,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
    overflow: 'hidden',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: Spacing.radiusSm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: Typography.md,
    fontWeight: Typography.medium,
  },
  subtitle: {
    fontSize: Typography.xs,
    marginTop: 2,
  },
  value: {
    fontSize: Typography.sm,
    marginRight: Spacing.sm,
  },
});
