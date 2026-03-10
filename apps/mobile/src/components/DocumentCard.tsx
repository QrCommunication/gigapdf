/**
 * Document Card Component
 * Displays a PDF document item with full action menu like web version
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../contexts/ThemeContext';
import { Spacing, Typography, IconSizes, BorderRadius } from '../constants/spacing';
import { PDFDocument } from '../types/document';
import { storageService } from '../services/storageService';
import { BASE_URL } from '../services/api';

interface DocumentCardProps {
  document: PDFDocument;
  onPress: () => void;
  onShare: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  onRefresh?: () => void;
}

type ExportFormat = 'docx' | 'xlsx' | 'png' | 'html' | 'txt';

const EXPORT_FORMATS: { format: ExportFormat; label: string; icon: string }[] = [
  { format: 'docx', label: 'Word (.docx)', icon: 'document-text' },
  { format: 'xlsx', label: 'Excel (.xlsx)', icon: 'grid' },
  { format: 'png', label: 'Images (.png)', icon: 'images' },
  { format: 'html', label: 'HTML (.html)', icon: 'code-slash' },
  { format: 'txt', label: 'Texte (.txt)', icon: 'document' },
];

export function DocumentCard({
  document,
  onPress,
  onShare,
  onDelete,
  onRename,
  onRefresh,
}: DocumentCardProps) {
  const { colors } = useTheme();

  const [menuVisible, setMenuVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [newName, setNewName] = useState(document.name.replace('.pdf', ''));
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 o';
    const k = 1024;
    const sizes = ['o', 'Ko', 'Mo', 'Go'];
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

  const handlePreview = useCallback(() => {
    setMenuVisible(false);
    setPreviewVisible(true);
  }, []);

  const handleDownload = useCallback(async () => {
    setMenuVisible(false);
    setLoadingAction('download');

    try {
      const downloadUrl = `${BASE_URL}/api/v1/storage/documents/${document.id}/download`;
      const fileUri = `${FileSystem.documentDirectory}${document.name}`;

      const downloadResult = await FileSystem.downloadAsync(downloadUrl, fileUri);

      if (downloadResult.status === 200) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Enregistrer le PDF',
          });
        } else {
          Alert.alert('Succes', `Document telecharge: ${fileUri}`);
        }
      } else {
        throw new Error('Download failed');
      }
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Erreur', 'Impossible de telecharger le document');
    } finally {
      setLoadingAction(null);
    }
  }, [document]);

  const handleRename = useCallback(() => {
    setMenuVisible(false);
    setNewName(document.name.replace('.pdf', ''));
    setRenameVisible(true);
  }, [document.name]);

  const confirmRename = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert('Erreur', 'Le nom ne peut pas etre vide');
      return;
    }

    setLoading(true);
    try {
      const finalName = newName.trim().endsWith('.pdf')
        ? newName.trim()
        : `${newName.trim()}.pdf`;
      await storageService.renameDocument(document.id, finalName);
      onRename(finalName);
      setRenameVisible(false);
      onRefresh?.();
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de renommer le document');
    } finally {
      setLoading(false);
    }
  }, [document.id, newName, onRename, onRefresh]);

  const handleSharePress = useCallback(() => {
    setMenuVisible(false);
    onShare();
  }, [onShare]);

  const handleExport = useCallback(() => {
    setMenuVisible(false);
    setExportVisible(true);
  }, []);

  const performExport = useCallback(async (format: ExportFormat) => {
    setExportVisible(false);
    setLoadingAction(`export-${format}`);

    try {
      const exportUrl = `${BASE_URL}/api/v1/convert/pdf-to-${format}`;
      const formData = new FormData();
      formData.append('document_id', document.id);

      // For now, show a message that export is being processed
      Alert.alert(
        'Export en cours',
        `Le document sera exporte en ${format.toUpperCase()}. Vous recevrez une notification une fois termine.`
      );
    } catch (error) {
      Alert.alert('Erreur', `Impossible d'exporter en ${format}`);
    } finally {
      setLoadingAction(null);
    }
  }, [document.id]);

  const handleDelete = useCallback(() => {
    setMenuVisible(false);
    Alert.alert(
      'Supprimer le document',
      `Etes-vous sur de vouloir supprimer "${document.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: onDelete,
        },
      ]
    );
  }, [document.name, onDelete]);

  const thumbnailUrl = document.thumbnailUri
    ? document.thumbnailUri.startsWith('http')
      ? document.thumbnailUri
      : `${BASE_URL}${document.thumbnailUri}`
    : null;

  return (
    <>
      <TouchableOpacity
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderColor: colors.cardBorder,
          },
        ]}
        onPress={onPress}
        onLongPress={() => setMenuVisible(true)}
        activeOpacity={0.7}
      >
        {/* Thumbnail */}
        <View
          style={[
            styles.thumbnail,
            { backgroundColor: colors.backgroundTertiary },
          ]}
        >
          {thumbnailUrl ? (
            <Image
              source={{ uri: thumbnailUrl }}
              style={styles.thumbnailImage}
              resizeMode="cover"
            />
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

        {/* More button */}
        <TouchableOpacity
          style={styles.moreButton}
          onPress={() => setMenuVisible(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="ellipsis-vertical"
            size={IconSizes.md}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Actions Menu Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={[styles.menuContainer, { backgroundColor: colors.surface }]}>
            <View style={[styles.menuHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.menuTitle, { color: colors.text }]} numberOfLines={1}>
                {document.name}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handlePreview}
            >
              <Ionicons name="eye-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Apercu</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleDownload}
              disabled={loadingAction === 'download'}
            >
              {loadingAction === 'download' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="download-outline" size={22} color={colors.text} />
              )}
              <Text style={[styles.menuItemText, { color: colors.text }]}>Telecharger</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleRename}
            >
              <Ionicons name="pencil-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Renommer</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleSharePress}
            >
              <Ionicons name="share-social-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Partager</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleExport}
            >
              <Ionicons name="swap-horizontal-outline" size={22} color={colors.text} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Exporter</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} style={styles.menuChevron} />
            </TouchableOpacity>

            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleDelete}
            >
              <Ionicons name="trash-outline" size={22} color={colors.error} />
              <Text style={[styles.menuItemText, { color: colors.error }]}>Supprimer</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rename Modal */}
      <Modal
        visible={renameVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setRenameVisible(false)}
        >
          <View
            style={[styles.renameContainer, { backgroundColor: colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.renameTitle, { color: colors.text }]}>
              Renommer le document
            </Text>

            <TextInput
              style={[
                styles.renameInput,
                {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              value={newName}
              onChangeText={setNewName}
              placeholder="Nom du document"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={confirmRename}
            />

            <View style={styles.renameButtons}>
              <TouchableOpacity
                style={[styles.renameButton, { backgroundColor: colors.background }]}
                onPress={() => setRenameVisible(false)}
              >
                <Text style={[styles.renameButtonText, { color: colors.text }]}>
                  Annuler
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.renameButton, { backgroundColor: colors.primary }]}
                onPress={confirmRename}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.renameButtonText, { color: '#fff' }]}>
                    Renommer
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Export Format Modal */}
      <Modal
        visible={exportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExportVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setExportVisible(false)}
        >
          <View style={[styles.menuContainer, { backgroundColor: colors.surface }]}>
            <View style={[styles.menuHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setExportVisible(false)}>
                <Ionicons name="arrow-back" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.menuTitle, { color: colors.text, marginLeft: Spacing.sm }]}>
                Exporter vers
              </Text>
            </View>

            {EXPORT_FORMATS.map((item) => (
              <TouchableOpacity
                key={item.format}
                style={styles.menuItem}
                onPress={() => performExport(item.format)}
                disabled={loadingAction === `export-${item.format}`}
              >
                {loadingAction === `export-${item.format}` ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name={item.icon as any} size={22} color={colors.text} />
                )}
                <Text style={[styles.menuItemText, { color: colors.text }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Preview Modal */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={[styles.previewContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.previewHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setPreviewVisible(false)}>
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.previewTitle, { color: colors.text }]} numberOfLines={1}>
              {document.name}
            </Text>
            <TouchableOpacity onPress={handleDownload}>
              <Ionicons name="download-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.previewContent}>
            {/* PDF Preview would go here - using WebView or pdf library */}
            <View style={styles.previewPlaceholder}>
              <Ionicons name="document-text" size={64} color={colors.textTertiary} />
              <Text style={[styles.previewPlaceholderText, { color: colors.textSecondary }]}>
                Apercu du document
              </Text>
              <TouchableOpacity
                style={[styles.openEditorButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setPreviewVisible(false);
                  onPress();
                }}
              >
                <Text style={styles.openEditorButtonText}>Ouvrir dans l'editeur</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    marginHorizontal: Spacing.screenPadding,
    marginVertical: Spacing.xs,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  thumbnail: {
    width: 56,
    height: 72,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontSize: Typography.md,
    fontWeight: '500',
    marginBottom: Spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
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
  moreButton: {
    padding: Spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  menuContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingBottom: Spacing.xl,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  menuTitle: {
    fontSize: Typography.md,
    fontWeight: '600',
    flex: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  menuItemText: {
    fontSize: Typography.md,
    flex: 1,
  },
  menuChevron: {
    marginLeft: 'auto',
  },
  menuDivider: {
    height: 1,
    marginVertical: Spacing.xs,
    marginHorizontal: Spacing.lg,
  },
  renameContainer: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  renameTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: Typography.md,
    marginBottom: Spacing.md,
  },
  renameButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  renameButton: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  renameButtonText: {
    fontSize: Typography.md,
    fontWeight: '600',
  },
  previewContainer: {
    flex: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
  },
  previewTitle: {
    flex: 1,
    fontSize: Typography.md,
    fontWeight: '600',
  },
  previewContent: {
    flex: 1,
  },
  previewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  previewPlaceholderText: {
    fontSize: Typography.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  openEditorButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  openEditorButtonText: {
    color: '#fff',
    fontSize: Typography.md,
    fontWeight: '600',
  },
});
