/**
 * PDFViewer Component
 * Renders PDF pages with react-native-pdf and supports annotation overlay
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Text,
} from 'react-native';
import Pdf from 'react-native-pdf';
import { useTheme } from '../../contexts/ThemeContext';
import { BASE_URL } from '../../services/api';
import { Spacing, Typography } from '../../constants/spacing';

const { width: screenWidth } = Dimensions.get('window');

export interface PDFViewerProps {
  documentId: string;
  currentPage: number;
  onPageChange: (page: number) => void;
  onLoadComplete: (numberOfPages: number, width: number, height: number) => void;
  onError: (error: Error) => void;
  onPageSingleTap?: (page: number, x: number, y: number) => void;
  onScaleChanged?: (scale: number) => void;
  scale?: number;
  horizontal?: boolean;
  enablePaging?: boolean;
  children?: React.ReactNode;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  documentId,
  currentPage,
  onPageChange,
  onLoadComplete,
  onError,
  onPageSingleTap,
  onScaleChanged,
  scale = 1.0,
  horizontal = false,
  enablePaging = true,
  children,
}) => {
  const { colors } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });

  // PDF source URL
  const source = {
    uri: `${BASE_URL}/api/v1/storage/documents/${documentId}/download`,
    cache: true,
  };

  const handleLoadComplete = useCallback(
    (numberOfPages: number, filePath: string, { width, height }: { width: number; height: number }) => {
      setLoading(false);
      setPageCount(numberOfPages);
      setPdfDimensions({ width, height });
      onLoadComplete(numberOfPages, width, height);
    },
    [onLoadComplete]
  );

  const handlePageChanged = useCallback(
    (page: number, numberOfPages: number) => {
      onPageChange(page);
    },
    [onPageChange]
  );

  const handleError = useCallback(
    (error: object) => {
      setLoading(false);
      console.error('[PDFViewer] Error loading PDF:', error);
      onError(error as Error);
    },
    [onError]
  );

  const handlePageSingleTap = useCallback(
    (page: number, x: number, y: number) => {
      onPageSingleTap?.(page, x, y);
    },
    [onPageSingleTap]
  );

  const handleScaleChanged = useCallback(
    (newScale: number) => {
      onScaleChanged?.(newScale);
    },
    [onScaleChanged]
  );

  // Navigate to page when currentPage prop changes
  useEffect(() => {
    if (pdfRef.current && currentPage > 0 && currentPage <= pageCount) {
      pdfRef.current.setPage(currentPage);
    }
  }, [currentPage, pageCount]);

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Chargement du PDF...
          </Text>
        </View>
      )}

      <Pdf
        ref={pdfRef}
        source={source}
        page={currentPage}
        scale={scale}
        minScale={0.5}
        maxScale={4.0}
        horizontal={horizontal}
        enablePaging={enablePaging}
        enableAntialiasing={true}
        enableAnnotationRendering={true}
        fitPolicy={0}
        spacing={10}
        password=""
        onLoadComplete={handleLoadComplete}
        onPageChanged={handlePageChanged}
        onError={handleError}
        onPageSingleTap={handlePageSingleTap}
        onScaleChanged={handleScaleChanged}
        style={[styles.pdf, { backgroundColor: colors.backgroundSecondary }]}
        trustAllCerts={false}
      />

      {/* Annotation overlay container */}
      {children && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {children}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  pdf: {
    flex: 1,
    width: screenWidth,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.1)',
    zIndex: 10,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.md,
  },
});

export default PDFViewer;
