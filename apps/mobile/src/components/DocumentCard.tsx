/**
 * Document Card Component
 * Displays a PDF document item in the list
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Spacing, Typography, IconSizes } from '../constants/spacing';
import { PDFDocument } from '../types/document';

interface DocumentCardProps {
  document: PDFDocument;
  onPress: () => void;
  onShare: () => void;
  onDelete: () => void;
  onFavorite: () => void;
}

export function DocumentCard({
  document,
  onPress,
  onShare,
  onDelete,
  onFavorite,
}: DocumentCardProps) {
  const { colors } = useTheme();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Aujourd'hui";
    } else if (diffDays === 1) {
      return 'Hier';
    } else if (diffDays < 7) {
      return `Il y a ${diffDays} jours`;
    } else {
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
  };

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
      {/* Thumbnail */}
      <View
        style={[
          styles.thumbnail,
          { backgroundColor: colors.backgroundTertiary },
        ]}
      >
        {document.thumbnailUri ? (
          <View style={styles.thumbnailImage} />
        ) : (
          <Ionicons
            name="document-text"
            size={32}
            color={colors.primary}
          />
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text
          style={[styles.name, { color: colors.text }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {document.name}
        </Text>
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {formatFileSize(document.size)}
          </Text>
          <View
            style={[styles.metaDot, { backgroundColor: colors.textTertiary }]}
          />
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {formatDate(document.modifiedAt)}
          </Text>
          {document.pageCount && (
            <>
              <View
                style={[
                  styles.metaDot,
                  { backgroundColor: colors.textTertiary },
                ]}
              />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {document.pageCount} pages
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onFavorite}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={document.isFavorite ? 'star' : 'star-outline'}
            size={IconSizes.sm}
            color={document.isFavorite ? '#F59E0B' : colors.textTertiary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onShare}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="share-outline"
            size={IconSizes.sm}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onDelete}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="trash-outline"
            size={IconSizes.sm}
            color={colors.error}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    marginHorizontal: Spacing.screenPadding,
    marginVertical: Spacing.xs,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
  },
  thumbnail: {
    width: 56,
    height: 72,
    borderRadius: Spacing.radiusSm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: Spacing.radiusSm,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontSize: Typography.md,
    fontWeight: Typography.medium,
    marginBottom: Spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: Typography.xs,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    marginHorizontal: Spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionButton: {
    padding: Spacing.xs,
  },
});
