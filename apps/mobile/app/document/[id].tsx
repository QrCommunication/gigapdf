/**
 * Document Editor Screen
 * Full PDF editor with all tools and page navigation
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  Dimensions,
  Modal,
  Pressable,
  FlatList,
  Share,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography, IconSizes } from '../../src/constants/spacing';
import { storageService, formatFileSize, formatRelativeDate, StoredDocument } from '../../src/services/storageService';
import { pagesService } from '../../src/services/pages';
import { pdfTools, toolCategories } from '../../src/constants/tools';
import { PDFTool, ToolCategory } from '../../src/types/tools';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const THUMBNAIL_WIDTH = 60;
const THUMBNAIL_HEIGHT = 80;

// Tool action types for modals
type ActiveToolType = null | 'rotate' | 'text' | 'image' | 'sign' | 'highlight' | 'note' | 'form';

export default function DocumentEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, theme } = useTheme();
  const router = useRouter();

  // Document state
  const [document, setDocument] = useState<StoredDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Page state
  const [currentPage, setCurrentPage] = useState(1);
  const [pagePreviewUrl, setPagePreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // UI state
  const [showToolsModal, setShowToolsModal] = useState(false);
  const [showMoreOptionsModal, setShowMoreOptionsModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveToolType>(null);

  // Refs
  const thumbnailScrollRef = useRef<ScrollView>(null);

  // ===========================================================================
  // Data Loading
  // ===========================================================================

  const loadDocument = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      console.log('[Editor] Loading document:', id);

      const doc = await storageService.getDocument(id);
      console.log('[Editor] Document loaded:', doc);
      setDocument(doc);

    } catch (err: any) {
      console.error('[Editor] Failed to load document:', err);
      setError(err.message || 'Impossible de charger le document');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadPagePreview = useCallback(async (pageNumber: number) => {
    if (!id) return;

    try {
      setLoadingPreview(true);
      console.log('[Editor] Loading page preview:', pageNumber);

      // Get page preview URL
      const preview = await pagesService.getPreview(id, pageNumber, screenWidth - 32);
      setPagePreviewUrl(preview.image_url || preview.url);

    } catch (err: any) {
      console.error('[Editor] Failed to load preview:', err);
      // Don't show error, just use placeholder
    } finally {
      setLoadingPreview(false);
    }
  }, [id]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  useEffect(() => {
    if (document && currentPage) {
      loadPagePreview(currentPage);
    }
  }, [document, currentPage, loadPagePreview]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDocument();
    setRefreshing(false);
  }, [loadDocument]);

  // ===========================================================================
  // Page Navigation
  // ===========================================================================

  const goToPage = useCallback((page: number) => {
    if (document && page >= 1 && page <= document.page_count) {
      setCurrentPage(page);

      // Scroll thumbnail into view
      thumbnailScrollRef.current?.scrollTo({
        x: (page - 1) * (THUMBNAIL_WIDTH + Spacing.sm),
        animated: true,
      });
    }
  }, [document]);

  const goToPreviousPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const goToNextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  // ===========================================================================
  // Tool Actions
  // ===========================================================================

  const handleToolPress = useCallback((tool: PDFTool) => {
    setShowToolsModal(false);

    // Handle tool action based on tool ID
    switch (tool.id) {
      case 'rotate':
        handleRotatePage();
        break;
      case 'delete-pages':
        handleDeletePage();
        break;
      case 'extract-pages':
        handleExtractPages();
        break;
      case 'extract-text':
        handleExtractText();
        break;
      default:
        // For tools that need a dedicated screen, navigate
        Alert.alert(
          tool.name,
          `L'outil "${tool.name}" sera bientôt disponible.\n\n${tool.description}`,
          [{ text: 'OK' }]
        );
    }
  }, [id, currentPage]);

  const handleRotatePage = useCallback(async () => {
    if (!id) return;

    const rotations = [
      { label: '90° horaire', value: 90 },
      { label: '180°', value: 180 },
      { label: '90° anti-horaire', value: 270 },
    ];

    Alert.alert(
      'Pivoter la page',
      `Page ${currentPage}`,
      [
        { text: 'Annuler', style: 'cancel' },
        ...rotations.map((r) => ({
          text: r.label,
          onPress: async () => {
            try {
              await pagesService.rotate(id, currentPage, { angle: r.value });
              Alert.alert('Succès', `Page pivotée de ${r.value}°`);
              loadPagePreview(currentPage);
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible de pivoter la page');
            }
          },
        })),
      ]
    );
  }, [id, currentPage, loadPagePreview]);

  const handleDeletePage = useCallback(() => {
    if (!id || !document) return;

    if (document.page_count <= 1) {
      Alert.alert('Erreur', 'Impossible de supprimer la dernière page du document');
      return;
    }

    Alert.alert(
      'Supprimer la page',
      `Êtes-vous sûr de vouloir supprimer la page ${currentPage} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await pagesService.delete(id, currentPage);
              Alert.alert('Succès', 'Page supprimée');
              // Reload document
              loadDocument();
              // Adjust current page if needed
              if (currentPage > document.page_count - 1) {
                setCurrentPage(Math.max(1, document.page_count - 1));
              }
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible de supprimer la page');
            }
          },
        },
      ]
    );
  }, [id, document, currentPage, loadDocument]);

  const handleExtractPages = useCallback(async () => {
    if (!id) return;

    Alert.alert(
      'Extraire les pages',
      'Créer un nouveau document avec les pages sélectionnées ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Page actuelle',
          onPress: async () => {
            try {
              const result = await pagesService.extract(id, { page_numbers: [currentPage] });
              Alert.alert('Succès', `Page extraite vers un nouveau document`);
            } catch (err: any) {
              Alert.alert('Erreur', err.message || "Impossible d'extraire la page");
            }
          },
        },
      ]
    );
  }, [id, currentPage]);

  const handleExtractText = useCallback(async () => {
    if (!id) return;

    try {
      const text = await pagesService.extractText(id, currentPage);
      Alert.alert(
        'Texte extrait',
        text.substring(0, 500) + (text.length > 500 ? '...' : ''),
        [
          { text: 'Fermer' },
          {
            text: 'Copier',
            onPress: () => {
              // In a real app, use Clipboard API
              Alert.alert('Info', 'Texte copié dans le presse-papiers');
            },
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Erreur', err.message || "Impossible d'extraire le texte");
    }
  }, [id, currentPage]);

  // ===========================================================================
  // Document Actions
  // ===========================================================================

  const handleDownload = useCallback(async () => {
    if (!id) return;

    try {
      const downloadUrl = await storageService.getDocumentDownloadUrl(id);
      // In a real app, use Linking or FileSystem to download
      Alert.alert('Téléchargement', 'Le document va être téléchargé...');
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de télécharger le document');
    }
  }, [id]);

  const handleShare = useCallback(async () => {
    if (!document) return;

    try {
      await Share.share({
        message: `Regardez ce document : ${document.name}`,
        title: document.name,
      });
    } catch (err: any) {
      console.error('Share error:', err);
    }
  }, [document]);

  const handleDelete = useCallback(() => {
    if (!id || !document) return;

    Alert.alert(
      'Supprimer le document',
      `Êtes-vous sûr de vouloir supprimer "${document.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await storageService.deleteDocument(id);
              Alert.alert('Succès', 'Document supprimé');
              router.back();
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible de supprimer le document');
            }
          },
        },
      ]
    );
  }, [id, document, router]);

  // ===========================================================================
  // Filtered Tools
  // ===========================================================================

  const filteredTools = useMemo(() => {
    if (selectedCategory) {
      const category = toolCategories.find((c) => c.id === selectedCategory);
      return category?.tools || [];
    }
    return pdfTools;
  }, [selectedCategory]);

  // ===========================================================================
  // Render Functions
  // ===========================================================================

  const renderThumbnail = (pageNumber: number) => {
    const isActive = pageNumber === currentPage;

    return (
      <TouchableOpacity
        key={pageNumber}
        style={[
          styles.thumbnail,
          { borderColor: isActive ? colors.primary : colors.border },
          isActive && { borderWidth: 2 },
        ]}
        onPress={() => goToPage(pageNumber)}
      >
        <View style={[styles.thumbnailInner, { backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[styles.thumbnailText, { color: colors.textSecondary }]}>
            {pageNumber}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderToolsModal = () => (
    <Modal
      visible={showToolsModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowToolsModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowToolsModal(false)}
      >
        <Pressable
          style={[styles.toolsModalContent, { backgroundColor: colors.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.toolsModalHeader}>
            <Text style={[styles.toolsModalTitle, { color: colors.text }]}>
              Outils PDF
            </Text>
            <TouchableOpacity onPress={() => setShowToolsModal(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Categories */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesScroll}
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

          {/* Tools Grid */}
          <FlatList
            data={filteredTools}
            numColumns={3}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.toolsGrid}
            renderItem={({ item: tool }) => (
              <TouchableOpacity
                style={[styles.toolItem, { backgroundColor: colors.background }]}
                onPress={() => handleToolPress(tool)}
              >
                <View
                  style={[
                    styles.toolIconContainer,
                    { backgroundColor: `${tool.color}20` },
                  ]}
                >
                  <Ionicons name={tool.icon as any} size={24} color={tool.color} />
                </View>
                <Text
                  style={[styles.toolName, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {tool.name}
                </Text>
                {tool.isNew && (
                  <View style={[styles.newBadge, { backgroundColor: colors.success }]}>
                    <Text style={styles.newBadgeText}>Nouveau</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderMoreOptionsModal = () => (
    <Modal
      visible={showMoreOptionsModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowMoreOptionsModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowMoreOptionsModal(false)}
      >
        <View style={[styles.optionsModalContent, { backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={styles.optionItem}
            onPress={() => {
              setShowMoreOptionsModal(false);
              handleDownload();
            }}
          >
            <Ionicons name="download-outline" size={24} color={colors.text} />
            <Text style={[styles.optionText, { color: colors.text }]}>
              Télécharger
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.optionItem}
            onPress={() => {
              setShowMoreOptionsModal(false);
              handleShare();
            }}
          >
            <Ionicons name="share-outline" size={24} color={colors.text} />
            <Text style={[styles.optionText, { color: colors.text }]}>
              Partager
            </Text>
          </TouchableOpacity>
          <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.optionItem}
            onPress={() => {
              setShowMoreOptionsModal(false);
              handleDelete();
            }}
          >
            <Ionicons name="trash-outline" size={24} color={colors.error} />
            <Text style={[styles.optionText, { color: colors.error }]}>
              Supprimer
            </Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );

  // ===========================================================================
  // Main Render
  // ===========================================================================

  // Loading state
  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Chargement...',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Chargement du document...
          </Text>
        </View>
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Erreur',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
        <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>
            Impossible de charger le document
          </Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={loadDocument}
          >
            <Text style={[styles.retryButtonText, { color: colors.textInverse }]}>
              Réessayer
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (!document) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: document.name,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setShowMoreOptionsModal(true)}
              style={{ marginRight: Spacing.md }}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
            </TouchableOpacity>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Document Info Bar */}
        <View style={[styles.infoBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            {document.page_count} pages • {formatFileSize(document.file_size_bytes)} • {formatRelativeDate(document.modified_at)}
          </Text>
        </View>

        {/* Page Thumbnails */}
        <View style={[styles.thumbnailsContainer, { backgroundColor: colors.surface }]}>
          <ScrollView
            ref={thumbnailScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbnailsScroll}
          >
            {Array.from({ length: document.page_count }, (_, i) => renderThumbnail(i + 1))}
          </ScrollView>
        </View>

        {/* Page Preview */}
        <ScrollView
          style={styles.previewContainer}
          contentContainerStyle={styles.previewContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <View style={[styles.pagePreview, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {loadingPreview ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : pagePreviewUrl ? (
              <Image
                source={{ uri: pagePreviewUrl }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.placeholderPreview}>
                <Ionicons name="document-text" size={64} color={colors.primary} />
                <Text style={[styles.previewPageNumber, { color: colors.text }]}>
                  Page {currentPage}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Page Navigation */}
        <View style={[styles.pageNavigation, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.navButton, currentPage <= 1 && styles.navButtonDisabled]}
            onPress={goToPreviousPage}
            disabled={currentPage <= 1}
          >
            <Ionicons
              name="chevron-back"
              size={24}
              color={currentPage <= 1 ? colors.textTertiary : colors.text}
            />
          </TouchableOpacity>

          <Text style={[styles.pageIndicator, { color: colors.text }]}>
            Page {currentPage} / {document.page_count}
          </Text>

          <TouchableOpacity
            style={[styles.navButton, currentPage >= document.page_count && styles.navButtonDisabled]}
            onPress={goToNextPage}
            disabled={currentPage >= document.page_count}
          >
            <Ionicons
              name="chevron-forward"
              size={24}
              color={currentPage >= document.page_count ? colors.textTertiary : colors.text}
            />
          </TouchableOpacity>
        </View>

        {/* Quick Tools Bar */}
        <View style={[styles.quickToolsBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickToolsScroll}
          >
            {/* Quick access tools */}
            {pdfTools.slice(0, 6).map((tool) => (
              <TouchableOpacity
                key={tool.id}
                style={styles.quickToolButton}
                onPress={() => handleToolPress(tool)}
              >
                <View
                  style={[
                    styles.quickToolIcon,
                    { backgroundColor: `${tool.color}20` },
                  ]}
                >
                  <Ionicons name={tool.icon as any} size={20} color={tool.color} />
                </View>
                <Text
                  style={[styles.quickToolLabel, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {tool.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* All tools button */}
          <TouchableOpacity
            style={[styles.allToolsButton, { backgroundColor: colors.primary }]}
            onPress={() => setShowToolsModal(true)}
          >
            <Ionicons name="apps" size={20} color={colors.textInverse} />
            <Text style={[styles.allToolsText, { color: colors.textInverse }]}>
              Tous
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Modals */}
      {renderToolsModal()}
      {renderMoreOptionsModal()}
    </>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  errorTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  errorText: {
    fontSize: Typography.md,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Spacing.radiusMd,
  },
  retryButtonText: {
    fontSize: Typography.md,
    fontWeight: '600',
  },
  infoBar: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
  },
  infoText: {
    fontSize: Typography.xs,
    textAlign: 'center',
  },
  thumbnailsContainer: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  thumbnailsScroll: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderRadius: Spacing.radiusSm,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: Spacing.sm,
  },
  thumbnailInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailText: {
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  previewContainer: {
    flex: 1,
  },
  previewContent: {
    padding: Spacing.md,
    flexGrow: 1,
  },
  pagePreview: {
    flex: 1,
    minHeight: screenHeight * 0.4,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  placeholderPreview: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  previewPageNumber: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  pageNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
  },
  navButton: {
    padding: Spacing.sm,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  pageIndicator: {
    fontSize: Typography.md,
    fontWeight: '500',
  },
  quickToolsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    borderTopWidth: 1,
  },
  quickToolsScroll: {
    paddingRight: Spacing.sm,
  },
  quickToolButton: {
    alignItems: 'center',
    marginRight: Spacing.md,
    width: 50,
  },
  quickToolIcon: {
    width: 40,
    height: 40,
    borderRadius: Spacing.radiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickToolLabel: {
    fontSize: Typography.xxs,
    marginTop: 4,
    textAlign: 'center',
  },
  allToolsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Spacing.radiusMd,
    marginLeft: 'auto',
    marginRight: Spacing.md,
    gap: Spacing.xs,
  },
  allToolsText: {
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  toolsModalContent: {
    maxHeight: screenHeight * 0.75,
    borderTopLeftRadius: Spacing.radiusLg,
    borderTopRightRadius: Spacing.radiusLg,
    paddingBottom: Spacing.xl,
  },
  toolsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  toolsModalTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
  },
  categoriesScroll: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  categoryPill: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Spacing.radiusFull,
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  categoryPillText: {
    fontSize: Typography.sm,
    fontWeight: '500',
  },
  toolsGrid: {
    padding: Spacing.md,
  },
  toolItem: {
    flex: 1,
    alignItems: 'center',
    padding: Spacing.md,
    margin: Spacing.xs,
    borderRadius: Spacing.radiusMd,
    maxWidth: '33%',
  },
  toolIconContainer: {
    width: 48,
    height: 48,
    borderRadius: Spacing.radiusMd,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  toolName: {
    fontSize: Typography.xs,
    textAlign: 'center',
    lineHeight: Typography.xs * 1.3,
  },
  newBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#fff',
  },
  optionsModalContent: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    borderRadius: Spacing.radiusLg,
    paddingVertical: Spacing.sm,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  optionText: {
    fontSize: Typography.md,
    fontWeight: '500',
  },
  optionDivider: {
    height: 1,
    marginVertical: Spacing.sm,
  },
});
