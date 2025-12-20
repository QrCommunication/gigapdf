/**
 * Tools Screen
 * Grid of available PDF tools
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
// Animated removed for Expo Go compatibility
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography, IconSizes } from '../../src/constants/spacing';
import { pdfTools, toolCategories, quickAccessTools, searchTools } from '../../src/constants/tools';
import { PDFTool, ToolCategory } from '../../src/types/tools';
import { ToolCard } from '../../src/components/ToolCard';
import { SearchBar } from '../../src/components/SearchBar';

const { width: screenWidth } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const CARD_GAP = Spacing.md;
const CARD_WIDTH =
  (screenWidth - Spacing.screenPadding * 2 - CARD_GAP) / COLUMN_COUNT;

type ViewMode = 'grid' | 'categories';

export default function ToolsScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Filter tools based on search
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) {
      if (selectedCategory) {
        const category = toolCategories.find((c) => c.id === selectedCategory);
        return category?.tools || [];
      }
      return pdfTools;
    }

    const query = searchQuery.toLowerCase();
    return pdfTools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query)
    );
  }, [searchQuery, selectedCategory]);

  const handleToolPress = useCallback(
    (tool: PDFTool) => {
      router.push(tool.route as any);
    },
    [router]
  );

  const renderToolCard = useCallback(
    ({ item, index }: { item: PDFTool; index: number }) => (
      <View
        style={[
          styles.cardContainer,
          { width: CARD_WIDTH },
          index % 2 === 0 ? { marginRight: CARD_GAP / 2 } : { marginLeft: CARD_GAP / 2 },
        ]}
      >
        <ToolCard tool={item} onPress={() => handleToolPress(item)} />
      </View>
    ),
    [handleToolPress]
  );

  const renderCategoryHeader = useCallback(() => (
    <View style={styles.categoryHeader}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroll}
      >
        <TouchableOpacity
          style={[
            styles.categoryPill,
            !selectedCategory && { backgroundColor: colors.primary },
            { borderColor: colors.border },
          ]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text
            style={[
              styles.categoryPillText,
              { color: !selectedCategory ? colors.textInverse : colors.textSecondary },
            ]}
          >
            Tous
          </Text>
        </TouchableOpacity>

        {toolCategories.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryPill,
              selectedCategory === category.id && { backgroundColor: colors.primary },
              { borderColor: colors.border },
            ]}
            onPress={() => setSelectedCategory(category.id)}
          >
            <Text
              style={[
                styles.categoryPillText,
                {
                  color:
                    selectedCategory === category.id
                      ? colors.textInverse
                      : colors.textSecondary,
                },
              ]}
            >
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  ), [selectedCategory, colors]);

  const renderHeader = useCallback(() => (
    <View style={styles.header}>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher un outil..."
      />
      {!searchQuery && renderCategoryHeader()}

      {/* Quick access section */}
      {!searchQuery && !selectedCategory && (
        <View
          style={styles.quickAccessSection}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Acces rapide
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickAccessScroll}
          >
            {pdfTools.slice(0, 4).map((tool, index) => (
              <TouchableOpacity
                key={tool.id}
                style={[
                  styles.quickAccessItem,
                  { backgroundColor: `${tool.color}15` },
                ]}
                onPress={() => handleToolPress(tool)}
              >
                <View
                  style={[
                    styles.quickAccessIcon,
                    { backgroundColor: `${tool.color}25` },
                  ]}
                >
                  <Ionicons name={tool.icon} size={24} color={tool.color} />
                </View>
                <Text
                  style={[styles.quickAccessText, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {tool.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Tools section title */}
      <View style={styles.toolsSectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {searchQuery
            ? `Resultats (${filteredTools.length})`
            : selectedCategory
            ? toolCategories.find((c) => c.id === selectedCategory)?.name
            : 'Tous les outils'}
        </Text>
        {!searchQuery && (
          <View style={styles.viewModeToggle}>
            <TouchableOpacity
              style={[
                styles.viewModeButton,
                viewMode === 'grid' && { backgroundColor: colors.backgroundSecondary },
              ]}
              onPress={() => setViewMode('grid')}
            >
              <Ionicons
                name="grid-outline"
                size={18}
                color={viewMode === 'grid' ? colors.primary : colors.textTertiary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.viewModeButton,
                viewMode === 'categories' && { backgroundColor: colors.backgroundSecondary },
              ]}
              onPress={() => setViewMode('categories')}
            >
              <Ionicons
                name="list-outline"
                size={18}
                color={viewMode === 'categories' ? colors.primary : colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  ), [
    searchQuery,
    selectedCategory,
    viewMode,
    colors,
    filteredTools.length,
    renderCategoryHeader,
    handleToolPress,
  ]);

  const renderEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <Ionicons
        name="search-outline"
        size={64}
        color={colors.textTertiary}
      />
      <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
        Aucun outil trouve
      </Text>
      <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
        Essayez avec un autre terme de recherche
      </Text>
    </View>
  ), [colors]);

  const renderCategorySection = useCallback(
    (category: ToolCategory) => (
      <View key={category.id} style={styles.categorySection}>
        <View style={styles.categorySectionHeader}>
          <Text style={[styles.categorySectionTitle, { color: colors.text }]}>
            {category.name}
          </Text>
          <Text style={[styles.categorySectionCount, { color: colors.textTertiary }]}>
            {category.tools.length} outil{category.tools.length > 1 ? 's' : ''}
          </Text>
        </View>
        <View style={styles.categoryToolsRow}>
          {category.tools.map((tool, index) => (
            <TouchableOpacity
              key={tool.id}
              style={[
                styles.categoryToolItem,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
              onPress={() => handleToolPress(tool)}
            >
              <View
                style={[
                  styles.categoryToolIcon,
                  { backgroundColor: `${tool.color}15` },
                ]}
              >
                <Ionicons name={tool.icon} size={24} color={tool.color} />
              </View>
              <View style={styles.categoryToolContent}>
                <Text
                  style={[styles.categoryToolName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {tool.name}
                </Text>
                <Text
                  style={[styles.categoryToolDesc, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {tool.description}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.textTertiary}
              />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    ),
    [colors, handleToolPress]
  );

  if (viewMode === 'categories' && !searchQuery) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {renderHeader()}
          {toolCategories.map(renderCategorySection)}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={filteredTools}
        renderItem={renderToolCard}
        keyExtractor={(item) => item.id}
        numColumns={COLUMN_COUNT}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={styles.columnWrapper}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  listContent: {
    paddingBottom: Spacing.xxl,
  },
  columnWrapper: {
    paddingHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.md,
  },
  cardContainer: {
    flex: 1,
  },
  header: {
    marginBottom: Spacing.md,
  },
  categoryHeader: {
    marginBottom: Spacing.md,
  },
  categoryScroll: {
    paddingHorizontal: Spacing.screenPadding,
    gap: Spacing.sm,
  },
  categoryPill: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Spacing.radiusFull,
    borderWidth: 1,
  },
  categoryPillText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  quickAccessSection: {
    marginBottom: Spacing.lg,
  },
  quickAccessScroll: {
    paddingHorizontal: Spacing.screenPadding,
    gap: Spacing.md,
  },
  quickAccessItem: {
    width: 100,
    padding: Spacing.md,
    borderRadius: Spacing.radiusMd,
    alignItems: 'center',
  },
  quickAccessIcon: {
    width: 48,
    height: 48,
    borderRadius: Spacing.radiusMd,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  quickAccessText: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.md,
  },
  toolsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginRight: Spacing.screenPadding,
  },
  viewModeToggle: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  viewModeButton: {
    padding: Spacing.sm,
    borderRadius: Spacing.radiusSm,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.xxl * 2,
  },
  emptyStateTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    marginTop: Spacing.md,
  },
  emptyStateText: {
    fontSize: Typography.md,
    marginTop: Spacing.xs,
  },
  categorySection: {
    marginBottom: Spacing.lg,
  },
  categorySectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.md,
  },
  categorySectionTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
  },
  categorySectionCount: {
    fontSize: Typography.sm,
  },
  categoryToolsRow: {
    gap: Spacing.sm,
  },
  categoryToolItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.screenPadding,
    padding: Spacing.md,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
  },
  categoryToolIcon: {
    width: 44,
    height: 44,
    borderRadius: Spacing.radiusSm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  categoryToolContent: {
    flex: 1,
  },
  categoryToolName: {
    fontSize: Typography.md,
    fontWeight: Typography.medium,
    marginBottom: 2,
  },
  categoryToolDesc: {
    fontSize: Typography.xs,
  },
});
