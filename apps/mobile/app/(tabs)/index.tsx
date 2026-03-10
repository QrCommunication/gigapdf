/**
 * Documents Explorer Screen
 * Full file explorer with folders, multi-select, and real API data
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Alert,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  TextInput,
  Image,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { BASE_URL } from '../../src/services/api';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography, IconSizes } from '../../src/constants/spacing';
import { SearchBar } from '../../src/components/SearchBar';
import { EmptyState } from '../../src/components/EmptyState';
import { FAB } from '../../src/components/FAB';
import {
  storageService,
  StoredDocument,
  Folder,
  formatFileSize,
  formatRelativeDate,
} from '../../src/services/storageService';

type SortOption = 'name' | 'created_at' | 'modified_at' | 'file_size';
type ViewMode = 'list' | 'grid';

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export default function DocumentsExplorerScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  // Data state
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: null, name: 'Mes Documents' }]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('modified_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  // Modals
  const [showSortModal, setShowSortModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveFolders, setMoveFolders] = useState<Folder[]>([]);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

  // Document actions modal
  const [showDocActionsModal, setShowDocActionsModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<StoredDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<'view' | 'edit'>('edit');
  const [actionLoading, setActionLoading] = useState(false);

  // ==========================================================================
  // Data fetching
  // ==========================================================================

  const fetchData = useCallback(async (folderId: string | null = currentFolderId) => {
    try {
      setLoading(true);
      console.log('[Documents] Fetching data for folder:', folderId);

      const [docsResponse, foldersResponse] = await Promise.all([
        storageService.listDocuments({
          folder_id: folderId,
          search: searchQuery || undefined,
          page: 1,
          per_page: 50,
        }),
        storageService.listFolders(folderId),
      ]);

      console.log('[Documents] Received documents:', docsResponse);
      console.log('[Documents] Received folders:', foldersResponse);

      setDocuments(docsResponse.items || []);
      setFolders(foldersResponse || []);
    } catch (error) {
      console.error('[Documents] Failed to fetch data:', error);
      Alert.alert('Erreur', 'Impossible de charger les documents. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [currentFolderId]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== '') {
        fetchData();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const navigateToFolder = useCallback((folder: Folder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name }]);
    clearSelection();
  }, []);

  const navigateToBreadcrumb = useCallback((item: BreadcrumbItem, index: number) => {
    setCurrentFolderId(item.id);
    setBreadcrumb(prev => prev.slice(0, index + 1));
    clearSelection();
  }, []);

  const handleDocumentPress = useCallback((doc: StoredDocument) => {
    if (selectionMode) {
      toggleDocumentSelection(doc.stored_document_id);
    } else {
      router.push(`/document/${doc.stored_document_id}`);
    }
  }, [selectionMode, router]);

  // ==========================================================================
  // Selection
  // ==========================================================================

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => !prev);
    if (selectionMode) {
      clearSelection();
    }
  }, [selectionMode]);

  const clearSelection = useCallback(() => {
    setSelectedDocuments(new Set());
    setSelectedFolders(new Set());
  }, []);

  const toggleDocumentSelection = useCallback((id: string) => {
    setSelectedDocuments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const toggleFolderSelection = useCallback((id: string) => {
    setSelectedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedDocuments(new Set(documents.map(d => d.stored_document_id)));
    setSelectedFolders(new Set(folders.map(f => f.id)));
  }, [documents, folders]);

  const totalSelected = selectedDocuments.size + selectedFolders.size;

  // ==========================================================================
  // Actions
  // ==========================================================================

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer un nom de dossier');
      return;
    }

    try {
      await storageService.createFolder(newFolderName.trim(), currentFolderId);
      setNewFolderName('');
      setShowNewFolderModal(false);
      fetchData();
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de créer le dossier');
    }
  }, [newFolderName, currentFolderId, fetchData]);

  const handleDeleteSelected = useCallback(() => {
    const count = totalSelected;
    Alert.alert(
      'Supprimer',
      `Êtes-vous sûr de vouloir supprimer ${count} élément(s) ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete folders first
              for (const folderId of selectedFolders) {
                await storageService.deleteFolder(folderId, true);
              }
              // Then delete documents
              await storageService.deleteDocuments(Array.from(selectedDocuments));

              clearSelection();
              setSelectionMode(false);
              fetchData();
            } catch (error) {
              Alert.alert('Erreur', 'Impossible de supprimer certains éléments');
            }
          },
        },
      ]
    );
  }, [totalSelected, selectedDocuments, selectedFolders, fetchData]);

  const openMoveModal = useCallback(async () => {
    try {
      // Load root folders for move destination
      const rootFolders = await storageService.listFolders(null);
      setMoveFolders(rootFolders);
      setMoveTargetId(null);
      setShowMoveModal(true);
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger les dossiers');
    }
  }, []);

  const handleMoveSelected = useCallback(async () => {
    try {
      // Move documents
      await storageService.moveDocuments(
        Array.from(selectedDocuments),
        moveTargetId
      );

      // Move folders
      for (const folderId of selectedFolders) {
        await storageService.moveFolder(folderId, moveTargetId);
      }

      setShowMoveModal(false);
      clearSelection();
      setSelectionMode(false);
      fetchData();
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de déplacer certains éléments');
    }
  }, [selectedDocuments, selectedFolders, moveTargetId, fetchData]);

  // ==========================================================================
  // Document Actions
  // ==========================================================================

  const openDocOptions = useCallback((doc: StoredDocument) => {
    setSelectedDoc(doc);
    setShowDocActionsModal(true);
  }, []);

  const handleDocDownload = useCallback(async () => {
    if (!selectedDoc) return;
    setShowDocActionsModal(false);
    setActionLoading(true);

    try {
      const downloadUrl = `${BASE_URL}/api/v1/storage/documents/${selectedDoc.stored_document_id}/download`;
      const fileUri = `${FileSystem.documentDirectory}${selectedDoc.name}`;

      const downloadResult = await FileSystem.downloadAsync(downloadUrl, fileUri);

      if (downloadResult.status === 200) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Enregistrer le PDF',
          });
        } else {
          Alert.alert('Succes', `Document telecharge dans ${fileUri}`);
        }
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de telecharger le document');
    } finally {
      setActionLoading(false);
    }
  }, [selectedDoc]);

  const handleDocRename = useCallback(() => {
    if (!selectedDoc) return;
    setShowDocActionsModal(false);
    setRenameValue(selectedDoc.name.replace('.pdf', ''));
    setShowRenameModal(true);
  }, [selectedDoc]);

  const confirmRename = useCallback(async () => {
    if (!selectedDoc || !renameValue.trim()) return;
    setActionLoading(true);

    try {
      const finalName = renameValue.trim().endsWith('.pdf')
        ? renameValue.trim()
        : `${renameValue.trim()}.pdf`;
      await storageService.renameDocument(selectedDoc.stored_document_id, finalName);
      setShowRenameModal(false);
      fetchData();
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de renommer le document');
    } finally {
      setActionLoading(false);
    }
  }, [selectedDoc, renameValue, fetchData]);

  const handleDocShare = useCallback(() => {
    setShowDocActionsModal(false);
    setShareEmail('');
    setSharePermission('edit');
    setShowShareModal(true);
  }, []);

  const confirmShare = useCallback(async () => {
    if (!selectedDoc || !shareEmail.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer une adresse email');
      return;
    }
    setActionLoading(true);

    try {
      const { sharingService } = await import('../../src/services/sharingService');
      await sharingService.shareDocument({
        document_id: selectedDoc.stored_document_id,
        invitee_email: shareEmail.trim(),
        permission: sharePermission,
      });
      Alert.alert('Succes', `Document partage avec ${shareEmail}`);
      setShowShareModal(false);
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de partager le document');
    } finally {
      setActionLoading(false);
    }
  }, [selectedDoc, shareEmail, sharePermission]);

  const handleDocExport = useCallback(() => {
    setShowDocActionsModal(false);
    setShowExportModal(true);
  }, []);

  const performExport = useCallback(async (format: string) => {
    if (!selectedDoc) return;
    setShowExportModal(false);
    Alert.alert(
      'Export en cours',
      `Le document sera exporte en ${format.toUpperCase()}. Cette fonctionnalite arrive bientot.`
    );
  }, [selectedDoc]);

  const handleDocDelete = useCallback(() => {
    if (!selectedDoc) return;
    setShowDocActionsModal(false);

    Alert.alert(
      'Supprimer le document',
      `Etes-vous sur de vouloir supprimer "${selectedDoc.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await storageService.deleteDocuments([selectedDoc.stored_document_id]);
              fetchData();
            } catch (error) {
              Alert.alert('Erreur', 'Impossible de supprimer le document');
            }
          },
        },
      ]
    );
  }, [selectedDoc, fetchData]);

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled && result.assets) {
        for (const asset of result.assets) {
          const file = {
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType || 'application/pdf',
          };

          await storageService.uploadDocument(file, {
            name: asset.name,
            folder_id: currentFolderId,
          });
        }

        Alert.alert('Succès', `${result.assets.length} document(s) importé(s)`);
        fetchData();
      }
    } catch (error) {
      Alert.alert('Erreur', "Impossible d'importer le document");
    }
  }, [currentFolderId, fetchData]);

  // ==========================================================================
  // Filtered & sorted data
  // ==========================================================================

  const filteredData = useMemo(() => {
    const items: Array<{ type: 'folder' | 'document'; data: Folder | StoredDocument }> = [];

    // Add folders first
    folders.forEach(folder => {
      if (!searchQuery || folder.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        items.push({ type: 'folder', data: folder });
      }
    });

    // Add documents
    documents.forEach(doc => {
      items.push({ type: 'document', data: doc });
    });

    return items;
  }, [folders, documents, searchQuery]);

  // ==========================================================================
  // Render functions
  // ==========================================================================

  const renderBreadcrumb = () => (
    <View style={styles.breadcrumbContainer}>
      {breadcrumb.map((item, index) => (
        <TouchableOpacity
          key={item.id || 'root'}
          style={styles.breadcrumbItem}
          onPress={() => navigateToBreadcrumb(item, index)}
          disabled={index === breadcrumb.length - 1}
        >
          {index > 0 && (
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textTertiary}
              style={styles.breadcrumbSeparator}
            />
          )}
          <Text
            style={[
              styles.breadcrumbText,
              {
                color: index === breadcrumb.length - 1 ? colors.text : colors.primary,
                fontWeight: index === breadcrumb.length - 1 ? '600' : '400',
              },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderSelectionBar = () => {
    if (!selectionMode) return null;

    return (
      <View style={[styles.selectionBar, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={toggleSelectionMode}>
          <Ionicons name="close" size={24} color={colors.textInverse} />
        </TouchableOpacity>
        <Text style={[styles.selectionText, { color: colors.textInverse }]}>
          {totalSelected} sélectionné(s)
        </Text>
        <View style={styles.selectionActions}>
          <TouchableOpacity onPress={selectAll} style={styles.selectionAction}>
            <Ionicons name="checkbox-outline" size={24} color={colors.textInverse} />
          </TouchableOpacity>
          {totalSelected > 0 && (
            <>
              <TouchableOpacity onPress={openMoveModal} style={styles.selectionAction}>
                <Ionicons name="folder-open-outline" size={24} color={colors.textInverse} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeleteSelected} style={styles.selectionAction}>
                <Ionicons name="trash-outline" size={24} color={colors.textInverse} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderToolbar = () => (
    <View style={styles.toolbar}>
      <View style={styles.toolbarLeft}>
        <TouchableOpacity
          style={[styles.toolbarButton, { borderColor: colors.border }]}
          onPress={() => setShowSortModal(true)}
        >
          <Ionicons name="swap-vertical" size={18} color={colors.textSecondary} />
          <Text style={[styles.toolbarButtonText, { color: colors.textSecondary }]}>
            Trier
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolbarButton, selectionMode && { backgroundColor: colors.primary }]}
          onPress={toggleSelectionMode}
        >
          <Ionicons
            name="checkbox-outline"
            size={18}
            color={selectionMode ? colors.textInverse : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
      <View style={styles.toolbarRight}>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setShowNewFolderModal(true)}
        >
          <Ionicons name="folder-outline" size={18} color={colors.primary} />
          <Ionicons
            name="add"
            size={12}
            color={colors.primary}
            style={{ marginLeft: -4 }}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setViewMode(v => (v === 'list' ? 'grid' : 'list'))}
        >
          <Ionicons
            name={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFolderItem = (folder: Folder) => {
    const isSelected = selectedFolders.has(folder.id);

    return (
      <TouchableOpacity
        style={[
          styles.itemContainer,
          { backgroundColor: colors.surface },
          isSelected && { backgroundColor: colors.primaryLight },
        ]}
        onPress={() => {
          if (selectionMode) {
            toggleFolderSelection(folder.id);
          } else {
            navigateToFolder(folder);
          }
        }}
        onLongPress={() => {
          if (!selectionMode) {
            setSelectionMode(true);
            toggleFolderSelection(folder.id);
          }
        }}
      >
        {selectionMode && (
          <Ionicons
            name={isSelected ? 'checkbox' : 'square-outline'}
            size={24}
            color={isSelected ? colors.primary : colors.textTertiary}
            style={styles.checkbox}
          />
        )}
        <View style={[styles.iconContainer, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="folder" size={24} color={colors.primary} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
            {folder.name}
          </Text>
          <Text style={[styles.itemMeta, { color: colors.textTertiary }]}>
            Dossier • {formatRelativeDate(folder.created_at)}
          </Text>
        </View>
        {!selectionMode && (
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        )}
      </TouchableOpacity>
    );
  };

  const renderDocumentItem = (doc: StoredDocument) => {
    const isSelected = selectedDocuments.has(doc.stored_document_id);

    return (
      <TouchableOpacity
        style={[
          styles.itemContainer,
          { backgroundColor: colors.surface },
          isSelected && { backgroundColor: colors.primaryLight },
        ]}
        onPress={() => handleDocumentPress(doc)}
        onLongPress={() => {
          if (!selectionMode) {
            setSelectionMode(true);
            toggleDocumentSelection(doc.stored_document_id);
          }
        }}
      >
        {selectionMode && (
          <Ionicons
            name={isSelected ? 'checkbox' : 'square-outline'}
            size={24}
            color={isSelected ? colors.primary : colors.textTertiary}
            style={styles.checkbox}
          />
        )}
        <View style={[styles.iconContainer, { backgroundColor: colors.error + '20' }]}>
          <Ionicons name="document-text" size={24} color={colors.error} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
            {doc.name}
          </Text>
          <Text style={[styles.itemMeta, { color: colors.textTertiary }]}>
            {doc.page_count} pages • {formatFileSize(doc.file_size_bytes)} • {formatRelativeDate(doc.modified_at)}
          </Text>
        </View>
        {!selectionMode && (
          <TouchableOpacity
            style={styles.moreButton}
            onPress={() => openDocOptions(doc)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: { type: 'folder' | 'document'; data: Folder | StoredDocument } }) => {
    if (item.type === 'folder') {
      return renderFolderItem(item.data as Folder);
    }
    return renderDocumentItem(item.data as StoredDocument);
  };

  const renderHeader = () => (
    <View style={styles.header}>
      {renderBreadcrumb()}
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Rechercher..."
      />
      {renderToolbar()}
      <Text style={[styles.itemCount, { color: colors.textTertiary }]}>
        {folders.length} dossier(s) • {documents.length} document(s)
      </Text>
    </View>
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Chargement...
          </Text>
        </View>
      );
    }

    if (searchQuery) {
      return (
        <EmptyState
          icon="search-outline"
          title="Aucun résultat"
          description="Aucun fichier ne correspond à votre recherche"
          actionLabel="Effacer la recherche"
          onAction={() => setSearchQuery('')}
        />
      );
    }

    return (
      <EmptyState
        icon="folder-open-outline"
        title="Dossier vide"
        description="Ce dossier ne contient aucun document. Importez vos PDF ou créez un sous-dossier."
        actionLabel="Importer un PDF"
        onAction={handleImport}
      />
    );
  };

  // ==========================================================================
  // Modals
  // ==========================================================================

  const renderSortModal = () => (
    <Modal
      visible={showSortModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowSortModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowSortModal(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Trier par</Text>

          {[
            { key: 'name', label: 'Nom', icon: 'text-outline' },
            { key: 'modified_at', label: 'Date de modification', icon: 'calendar-outline' },
            { key: 'created_at', label: 'Date de création', icon: 'time-outline' },
            { key: 'file_size', label: 'Taille', icon: 'file-tray-outline' },
          ].map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.modalOption,
                sortBy === option.key && { backgroundColor: colors.backgroundSecondary },
              ]}
              onPress={() => {
                if (sortBy === option.key) {
                  setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
                } else {
                  setSortBy(option.key as SortOption);
                  setSortOrder('desc');
                }
                setShowSortModal(false);
              }}
            >
              <Ionicons
                name={option.icon as any}
                size={20}
                color={sortBy === option.key ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.modalOptionText,
                  { color: sortBy === option.key ? colors.primary : colors.text },
                ]}
              >
                {option.label}
              </Text>
              {sortBy === option.key && (
                <Ionicons
                  name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'}
                  size={20}
                  color={colors.primary}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );

  const renderNewFolderModal = () => (
    <Modal
      visible={showNewFolderModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowNewFolderModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowNewFolderModal(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Nouveau dossier</Text>
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: colors.background,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder="Nom du dossier"
            placeholderTextColor={colors.textTertiary}
            value={newFolderName}
            onChangeText={setNewFolderName}
            autoFocus
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalButton, { borderColor: colors.border }]}
              onPress={() => {
                setNewFolderName('');
                setShowNewFolderModal(false);
              }}
            >
              <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>
                Annuler
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={handleCreateFolder}
            >
              <Text style={[styles.modalButtonText, { color: colors.textInverse }]}>
                Créer
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );

  const renderMoveModal = () => (
    <Modal
      visible={showMoveModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowMoveModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowMoveModal(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>Déplacer vers</Text>

          <TouchableOpacity
            style={[
              styles.modalOption,
              moveTargetId === null && { backgroundColor: colors.backgroundSecondary },
            ]}
            onPress={() => setMoveTargetId(null)}
          >
            <Ionicons name="home-outline" size={20} color={colors.primary} />
            <Text style={[styles.modalOptionText, { color: colors.text }]}>
              Mes Documents (racine)
            </Text>
            {moveTargetId === null && (
              <Ionicons name="checkmark" size={20} color={colors.primary} />
            )}
          </TouchableOpacity>

          {moveFolders
            .filter(f => !selectedFolders.has(f.id))
            .map((folder) => (
              <TouchableOpacity
                key={folder.id}
                style={[
                  styles.modalOption,
                  moveTargetId === folder.id && { backgroundColor: colors.backgroundSecondary },
                ]}
                onPress={() => setMoveTargetId(folder.id)}
              >
                <Ionicons name="folder-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.modalOptionText, { color: colors.text }]}>
                  {folder.name}
                </Text>
                {moveTargetId === folder.id && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalButton, { borderColor: colors.border }]}
              onPress={() => setShowMoveModal(false)}
            >
              <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>
                Annuler
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={handleMoveSelected}
            >
              <Text style={[styles.modalButtonText, { color: colors.textInverse }]}>
                Déplacer
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );

  // ==========================================================================
  // Main render
  // ==========================================================================

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderSelectionBar()}

      <FlatList
        data={filteredData}
        renderItem={renderItem}
        keyExtractor={(item) =>
          item.type === 'folder'
            ? `folder-${(item.data as Folder).id}`
            : `doc-${(item.data as StoredDocument).stored_document_id}`
        }
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          filteredData.length === 0 && styles.emptyListContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        )}
      />

      {!selectionMode && <FAB icon="add" onPress={handleImport} />}

      {renderSortModal()}
      {renderNewFolderModal()}
      {renderMoveModal()}

      {/* Document Actions Modal */}
      <Modal
        visible={showDocActionsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDocActionsModal(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setShowDocActionsModal(false)}
        >
          <View style={[styles.docActionsModal, { backgroundColor: colors.surface }]}>
            <View style={[styles.docActionsHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.docActionsTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedDoc?.name}
              </Text>
            </View>

            <TouchableOpacity style={styles.docActionItem} onPress={() => {
              setShowDocActionsModal(false);
              if (selectedDoc) router.push(`/document/${selectedDoc.stored_document_id}`);
            }}>
              <Ionicons name="eye-outline" size={22} color={colors.text} />
              <Text style={[styles.docActionText, { color: colors.text }]}>Apercu</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.docActionItem} onPress={handleDocDownload}>
              <Ionicons name="download-outline" size={22} color={colors.text} />
              <Text style={[styles.docActionText, { color: colors.text }]}>Telecharger</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.docActionItem} onPress={handleDocRename}>
              <Ionicons name="pencil-outline" size={22} color={colors.text} />
              <Text style={[styles.docActionText, { color: colors.text }]}>Renommer</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.docActionItem} onPress={handleDocShare}>
              <Ionicons name="share-social-outline" size={22} color={colors.text} />
              <Text style={[styles.docActionText, { color: colors.text }]}>Partager</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.docActionItem} onPress={handleDocExport}>
              <Ionicons name="swap-horizontal-outline" size={22} color={colors.text} />
              <Text style={[styles.docActionText, { color: colors.text }]}>Exporter</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={[styles.docActionDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity style={styles.docActionItem} onPress={handleDocDelete}>
              <Ionicons name="trash-outline" size={22} color={colors.error} />
              <Text style={[styles.docActionText, { color: colors.error }]}>Supprimer</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Rename Modal */}
      <Modal
        visible={showRenameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRenameModal(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setShowRenameModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Renommer</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Nom du document"
              placeholderTextColor={colors.textTertiary}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: colors.border }]}
                onPress={() => setShowRenameModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={confirmRename}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Renommer</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Share Modal */}
      <Modal
        visible={showShareModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShareModal(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setShowShareModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Partager le document</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Adresse email"
              placeholderTextColor={colors.textTertiary}
              value={shareEmail}
              onChangeText={setShareEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <View style={styles.permissionRow}>
              <Text style={[styles.permissionLabel, { color: colors.text }]}>Permission:</Text>
              <View style={styles.permissionButtons}>
                <TouchableOpacity
                  style={[
                    styles.permissionButton,
                    { borderColor: colors.border },
                    sharePermission === 'view' && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  onPress={() => setSharePermission('view')}
                >
                  <Text style={[styles.permissionButtonText, { color: sharePermission === 'view' ? '#fff' : colors.text }]}>
                    Lecture
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.permissionButton,
                    { borderColor: colors.border },
                    sharePermission === 'edit' && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                  onPress={() => setSharePermission('edit')}
                >
                  <Text style={[styles.permissionButtonText, { color: sharePermission === 'edit' ? '#fff' : colors.text }]}>
                    Modifier
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: colors.border }]}
                onPress={() => setShowShareModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={confirmShare}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Partager</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Export Modal */}
      <Modal
        visible={showExportModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExportModal(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setShowExportModal(false)}
        >
          <View style={[styles.docActionsModal, { backgroundColor: colors.surface }]}>
            <View style={[styles.docActionsHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setShowExportModal(false)}>
                <Ionicons name="arrow-back" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.docActionsTitle, { color: colors.text, marginLeft: Spacing.sm }]}>
                Exporter vers
              </Text>
            </View>

            {[
              { format: 'docx', label: 'Word (.docx)', icon: 'document-text' },
              { format: 'xlsx', label: 'Excel (.xlsx)', icon: 'grid' },
              { format: 'png', label: 'Images (.png)', icon: 'images' },
              { format: 'html', label: 'HTML (.html)', icon: 'code-slash' },
              { format: 'txt', label: 'Texte (.txt)', icon: 'document' },
            ].map((item) => (
              <TouchableOpacity
                key={item.format}
                style={styles.docActionItem}
                onPress={() => performExport(item.format)}
              >
                <Ionicons name={item.icon as any} size={22} color={colors.text} />
                <Text style={[styles.docActionText, { color: colors.text }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 100,
  },
  emptyListContent: {
    flex: 1,
  },
  header: {
    paddingTop: Spacing.md,
  },
  breadcrumbContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.sm,
    flexWrap: 'wrap',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbSeparator: {
    marginHorizontal: 4,
  },
  breadcrumbText: {
    fontSize: Typography.sm,
    maxWidth: 120,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.screenPadding,
    marginVertical: Spacing.sm,
  },
  toolbarLeft: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  toolbarRight: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Spacing.radiusSm,
    gap: Spacing.xs,
  },
  toolbarButtonText: {
    fontSize: Typography.sm,
  },
  itemCount: {
    fontSize: Typography.xs,
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.sm,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.screenPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  selectionText: {
    flex: 1,
    fontSize: Typography.md,
    fontWeight: '600',
  },
  selectionActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  selectionAction: {
    padding: Spacing.xs,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.screenPadding,
    gap: Spacing.md,
  },
  checkbox: {
    marginRight: Spacing.xs,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: Spacing.radiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: Typography.md,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemMeta: {
    fontSize: Typography.xs,
  },
  moreButton: {
    padding: Spacing.sm,
  },
  separator: {
    height: 1,
    marginLeft: Spacing.screenPadding + 44 + Spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.md,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxWidth: 360,
    borderRadius: Spacing.radiusLg,
    padding: Spacing.lg,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Spacing.radiusSm,
    gap: Spacing.md,
  },
  modalOptionText: {
    flex: 1,
    fontSize: Typography.md,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: Spacing.radiusSm,
    padding: Spacing.md,
    fontSize: Typography.md,
    marginBottom: Spacing.md,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  modalButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Spacing.radiusSm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalButtonText: {
    fontSize: Typography.md,
    fontWeight: '500',
  },
  docActionsModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: Spacing.radiusLg,
    borderTopRightRadius: Spacing.radiusLg,
    paddingBottom: Spacing.xl,
  },
  docActionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  docActionsTitle: {
    fontSize: Typography.md,
    fontWeight: '600',
    flex: 1,
  },
  docActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  docActionText: {
    fontSize: Typography.md,
    flex: 1,
  },
  docActionDivider: {
    height: 1,
    marginVertical: Spacing.xs,
    marginHorizontal: Spacing.lg,
  },
  permissionRow: {
    marginBottom: Spacing.md,
  },
  permissionLabel: {
    fontSize: Typography.sm,
    marginBottom: Spacing.xs,
  },
  permissionButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  permissionButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Spacing.radiusSm,
    borderWidth: 1,
    alignItems: 'center',
  },
  permissionButtonText: {
    fontSize: Typography.sm,
    fontWeight: '500',
  },
});
