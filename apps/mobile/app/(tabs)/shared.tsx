/**
 * Shared with Me Tab
 * Displays documents shared with the current user
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography, BorderRadius } from '../../src/constants/spacing';
import { sharingService, SharedDocument } from '../../src/services/sharingService';

type FilterSource = 'all' | 'direct' | 'organization';

export default function SharedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterSource, setFilterSource] = useState<FilterSource>('all');

  const loadDocuments = useCallback(async (pageNum: number = 1, refresh: boolean = false) => {
    try {
      if (pageNum === 1) {
        if (refresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      } else {
        setLoadingMore(true);
      }

      const result = await sharingService.getSharedWithMe({
        page: pageNum,
        per_page: 20,
        source: filterSource,
      });

      if (pageNum === 1) {
        setDocuments(result.items);
      } else {
        setDocuments(prev => [...prev, ...result.items]);
      }
      setPage(pageNum);
      setTotalPages(result.total_pages);
    } catch (error) {
      console.error('Error loading shared documents:', error);
      Alert.alert('Erreur', 'Impossible de charger les documents partagés');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filterSource]);

  useEffect(() => {
    loadDocuments(1);
  }, [filterSource]);

  const handleRefresh = useCallback(() => {
    loadDocuments(1, true);
  }, [loadDocuments]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && page < totalPages) {
      loadDocuments(page + 1);
    }
  }, [loadingMore, page, totalPages, loadDocuments]);

  const handleDocumentPress = useCallback((doc: SharedDocument) => {
    router.push(`/document/${doc.id}`);
  }, [router]);

  const handleRemoveShare = useCallback(async (doc: SharedDocument) => {
    Alert.alert(
      'Retirer des partages',
      `Voulez-vous retirer "${doc.name}" de vos documents partagés ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: async () => {
            try {
              await sharingService.removeFromSharedWithMe(doc.share_id);
              setDocuments(prev => prev.filter(d => d.share_id !== doc.share_id));
            } catch (error) {
              Alert.alert('Erreur', 'Impossible de retirer le partage');
            }
          },
        },
      ]
    );
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const renderFilterButton = (source: FilterSource, label: string) => (
    <TouchableOpacity
      style={[
        styles.filterButton,
        {
          backgroundColor: filterSource === source ? colors.primary : colors.surface,
          borderColor: filterSource === source ? colors.primary : colors.border,
        },
      ]}
      onPress={() => setFilterSource(source)}
    >
      <Text
        style={[
          styles.filterButtonText,
          {
            color: filterSource === source ? '#fff' : colors.textSecondary,
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderDocument = ({ item }: { item: SharedDocument }) => (
    <TouchableOpacity
      style={[styles.documentCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => handleDocumentPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.documentIcon}>
        <Ionicons name="document-text" size={32} color={colors.primary} />
      </View>

      <View style={styles.documentInfo}>
        <Text style={[styles.documentName, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>

        <View style={styles.documentMeta}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {item.page_count} page{item.page_count > 1 ? 's' : ''} • {formatFileSize(item.file_size_bytes)}
          </Text>
        </View>

        <View style={styles.shareInfo}>
          <View style={styles.sharedBy}>
            <Ionicons name="person-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.sharedByText, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.owner.email}
            </Text>
          </View>

          <View
            style={[
              styles.permissionBadge,
              {
                backgroundColor: item.permission === 'edit' ? colors.success + '20' : colors.info + '20',
              },
            ]}
          >
            <Ionicons
              name={item.permission === 'edit' ? 'pencil' : 'eye'}
              size={10}
              color={item.permission === 'edit' ? colors.success : colors.info}
            />
            <Text
              style={[
                styles.permissionText,
                { color: item.permission === 'edit' ? colors.success : colors.info },
              ]}
            >
              {item.permission === 'edit' ? 'Modifier' : 'Lecture'}
            </Text>
          </View>
        </View>

        <Text style={[styles.dateText, { color: colors.textTertiary }]}>
          Partagé le {formatDate(item.shared_at)}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.moreButton}
        onPress={() => handleRemoveShare(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close-circle-outline" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="share-outline" size={64} color={colors.textTertiary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        Aucun document partagé
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Les documents partagés avec vous apparaîtront ici
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Chargement...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Filter buttons */}
      <View style={styles.filterContainer}>
        {renderFilterButton('all', 'Tous')}
        {renderFilterButton('direct', 'Direct')}
        {renderFilterButton('organization', 'Organisation')}
      </View>

      {/* Document list */}
      <FlatList
        data={documents}
        keyExtractor={(item) => item.share_id}
        renderItem={renderDocument}
        contentContainerStyle={[
          styles.listContent,
          documents.length === 0 && styles.emptyList,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.md,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  filterButtonText: {
    fontSize: Typography.sm,
    fontWeight: '500',
  },
  listContent: {
    padding: Spacing.md,
    paddingTop: 0,
  },
  emptyList: {
    flex: 1,
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  documentIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  documentInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  documentName: {
    fontSize: Typography.md,
    fontWeight: '600',
    marginBottom: 2,
  },
  documentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaText: {
    fontSize: Typography.xs,
  },
  shareInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  sharedBy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  sharedByText: {
    fontSize: Typography.xs,
    flex: 1,
  },
  permissionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  permissionText: {
    fontSize: 10,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 10,
  },
  moreButton: {
    padding: Spacing.xs,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: Typography.sm,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  loadingMore: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
});
