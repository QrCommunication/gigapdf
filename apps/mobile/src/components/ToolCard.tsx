/**
 * Tool Card Component
 * Displays a PDF tool item in the grid
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Spacing, Typography } from '../constants/spacing';
import { PDFTool } from '../types/tools';

interface ToolCardProps {
  tool: PDFTool;
  onPress: () => void;
}

export function ToolCard({ tool, onPress }: ToolCardProps) {
  const { colors, theme } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Badges */}
      {(tool.isNew || tool.isPremium) && (
        <View style={styles.badges}>
          {tool.isNew && (
            <View style={[styles.badge, { backgroundColor: colors.success }]}>
              <Text style={styles.badgeText}>Nouveau</Text>
            </View>
          )}
          {tool.isPremium && (
            <View style={[styles.badge, { backgroundColor: colors.warning }]}>
              <Ionicons name="star" size={10} color="#FFF" />
              <Text style={styles.badgeText}>Pro</Text>
            </View>
          )}
        </View>
      )}

      {/* Icon */}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor:
              theme === 'light'
                ? `${tool.color}15`
                : `${tool.color}30`,
          },
        ]}
      >
        <Ionicons name={tool.icon} size={28} color={tool.color} />
      </View>

      {/* Content */}
      <Text
        style={[styles.name, { color: colors.text }]}
        numberOfLines={2}
      >
        {tool.name}
      </Text>
      <Text
        style={[styles.description, { color: colors.textSecondary }]}
        numberOfLines={2}
      >
        {tool.description}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
    minHeight: 160,
  },
  badges: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Spacing.radiusSm,
    gap: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: Typography.bold,
    color: '#FFFFFF',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: Spacing.radiusMd,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  name: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
    marginBottom: Spacing.xs,
  },
  description: {
    fontSize: Typography.xs,
    lineHeight: Typography.xs * Typography.lineHeightNormal,
  },
});
