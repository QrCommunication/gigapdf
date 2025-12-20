/**
 * Example Screen Implementation
 * Complete example of using the GigaPDF API services in a React Native screen
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Import services
import { documentsService, pagesService } from './index';
import type { Document } from './types';
import { getErrorMessage, formatBytes, formatDateTime } from './utils';

/**
 * Documents List Screen
 * Shows a list of user's documents with upload functionality
 */
export function DocumentsScreen() {
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState(0);

  // Query for fetching documents
  const {
    data: documentsResponse,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['documents', { page: 1, per_page: 20 }],
    queryFn: () => documentsService.list({ page: 1, per_page: 20 }),
    staleTime: 1 * 60 * 1000, // 1 minute
  });

  // Mutation for uploading documents
  const uploadMutation = useMutation({
    mutationFn: (file: any) =>
      documentsService.upload({ file }, (progress) => {
        setUploadProgress(progress);
      }),
    onSuccess: (document) => {
      Alert.alert('Success', `Document "${document.title}" uploaded successfully!`);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setUploadProgress(0);
    },
    onError: (error) => {
      Alert.alert('Upload Failed', getErrorMessage(error));
      setUploadProgress(0);
    },
  });

  // Mutation for deleting documents
  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsService.delete(id),
    onSuccess: () => {
      Alert.alert('Success', 'Document deleted successfully!');
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => {
      Alert.alert('Delete Failed', getErrorMessage(error));
    },
  });

  // Handle document picker
  const handlePickAndUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.assets && result.assets[0]) {
        uploadMutation.mutate(result.assets[0]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  // Handle delete with confirmation
  const handleDelete = (document: Document) => {
    Alert.alert(
      'Delete Document',
      `Are you sure you want to delete "${document.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(document.id),
        },
      ]
    );
  };

  // Render document item
  const renderDocument = ({ item }: { item: Document }) => (
    <TouchableOpacity
      style={styles.documentItem}
      onPress={() => {
        // Navigate to document viewer
        console.log('Open document:', item.id);
      }}
    >
      <View style={styles.documentInfo}>
        <Text style={styles.documentTitle}>{item.title}</Text>
        <Text style={styles.documentMeta}>
          {item.page_count} pages • {formatBytes(item.file_size)}
        </Text>
        <Text style={styles.documentDate}>{formatDateTime(item.created_at)}</Text>
      </View>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDelete(item)}
        disabled={deleteMutation.isPending}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading documents...</Text>
      </View>
    );
  }

  // Error state
  if (isError) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Failed to load documents</Text>
        <Text style={styles.errorDetail}>{getErrorMessage(error)}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const documents = documentsResponse?.data || [];

  return (
    <View style={styles.container}>
      {/* Upload Progress */}
      {uploadMutation.isPending && (
        <View style={styles.uploadProgress}>
          <Text style={styles.uploadProgressText}>
            Uploading... {uploadProgress}%
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${uploadProgress}%` }]}
            />
          </View>
        </View>
      )}

      {/* Documents List */}
      <FlatList
        data={documents}
        renderItem={renderDocument}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No documents yet</Text>
            <Text style={styles.emptySubtext}>
              Upload your first PDF to get started
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} />
        }
      />

      {/* Upload Button */}
      <TouchableOpacity
        style={styles.uploadButton}
        onPress={handlePickAndUpload}
        disabled={uploadMutation.isPending}
      >
        <Text style={styles.uploadButtonText}>
          {uploadMutation.isPending ? 'Uploading...' : 'Upload PDF'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Document Viewer Screen
 * Shows document pages with navigation
 */
export function DocumentViewerScreen({ documentId }: { documentId: string }) {
  const [currentPage, setCurrentPage] = useState(1);

  // Query for document
  const { data: document, isLoading: isLoadingDoc } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => documentsService.get(documentId),
  });

  // Query for pages
  const { data: pages, isLoading: isLoadingPages } = useQuery({
    queryKey: ['pages', documentId],
    queryFn: () => pagesService.list(documentId),
    enabled: !!document,
  });

  // Query for page preview
  const { data: preview, isLoading: isLoadingPreview } = useQuery({
    queryKey: ['page-preview', documentId, currentPage],
    queryFn: () => pagesService.getPreview(documentId, currentPage, 800, 1200),
    enabled: !!pages && currentPage > 0,
  });

  // Mutation for rotating page
  const rotateMutation = useMutation({
    mutationFn: (rotation: number) =>
      pagesService.rotate(documentId, currentPage, { rotation }),
    onSuccess: () => {
      Alert.alert('Success', 'Page rotated successfully!');
    },
  });

  if (isLoadingDoc || isLoadingPages) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!document || !pages) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Document not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Document Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{document.title}</Text>
        <Text style={styles.headerSubtitle}>
          Page {currentPage} of {document.page_count}
        </Text>
      </View>

      {/* Page Preview */}
      <View style={styles.previewContainer}>
        {isLoadingPreview ? (
          <ActivityIndicator size="large" color="#007AFF" />
        ) : preview ? (
          <img
            src={preview.preview_url}
            alt={`Page ${currentPage}`}
            style={styles.previewImage}
          />
        ) : (
          <Text>Failed to load preview</Text>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {/* Navigation */}
        <View style={styles.navigation}>
          <TouchableOpacity
            style={[styles.navButton, currentPage === 1 && styles.navButtonDisabled]}
            onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <Text style={styles.navButtonText}>Previous</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.navButton,
              currentPage === document.page_count && styles.navButtonDisabled,
            ]}
            onPress={() =>
              setCurrentPage((p) => Math.min(document.page_count, p + 1))
            }
            disabled={currentPage === document.page_count}
          >
            <Text style={styles.navButtonText}>Next</Text>
          </TouchableOpacity>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => rotateMutation.mutate(90)}
            disabled={rotateMutation.isPending}
          >
            <Text style={styles.actionButtonText}>Rotate 90°</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/**
 * Styles
 */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadProgress: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  uploadProgressText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
  listContent: {
    padding: 16,
  },
  documentItem: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  documentInfo: {
    flex: 1,
  },
  documentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  documentMeta: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  documentDate: {
    fontSize: 12,
    color: '#999',
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FF3B30',
    borderRadius: 4,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
  uploadButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#007AFF',
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  uploadButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  previewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  controls: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  navButtonDisabled: {
    backgroundColor: '#CCC',
  },
  navButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#34C759',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default { DocumentsScreen, DocumentViewerScreen };
