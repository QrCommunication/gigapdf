/**
 * EditorToolbar Component
 * Toolbar for PDF editing with tools selection, colors, and actions
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { Spacing, Typography, BorderRadius } from '../../constants/spacing';
import {
  EditorTool,
  toolColors,
  strokeWidths,
} from '../../types/annotations';

interface EditorToolbarProps {
  activeTool: EditorTool;
  activeColor: string;
  strokeWidth: number;
  onToolChange: (tool: EditorTool) => void;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isModified: boolean;
  isSaving: boolean;
}

interface ToolItem {
  id: EditorTool;
  icon: string;
  label: string;
  group: 'select' | 'draw' | 'annotate' | 'shape';
}

const tools: ToolItem[] = [
  { id: 'select', icon: 'hand-left-outline', label: 'Selection', group: 'select' },
  { id: 'drawing', icon: 'pencil', label: 'Crayon', group: 'draw' },
  { id: 'highlight', icon: 'color-fill-outline', label: 'Surligner', group: 'annotate' },
  { id: 'text', icon: 'text', label: 'Texte', group: 'annotate' },
  { id: 'rectangle', icon: 'square-outline', label: 'Rectangle', group: 'shape' },
  { id: 'circle', icon: 'ellipse-outline', label: 'Cercle', group: 'shape' },
  { id: 'arrow', icon: 'arrow-forward-outline', label: 'Fleche', group: 'shape' },
  { id: 'eraser', icon: 'backspace-outline', label: 'Gomme', group: 'draw' },
];

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  activeTool,
  activeColor,
  strokeWidth,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  onSave,
  canUndo,
  canRedo,
  isModified,
  isSaving,
}) => {
  const { colors } = useTheme();
  const [showToolsModal, setShowToolsModal] = useState(false);
  const [showColorModal, setShowColorModal] = useState(false);
  const [showStrokeModal, setShowStrokeModal] = useState(false);

  const currentTool = tools.find((t) => t.id === activeTool);

  return (
    <>
      {/* Main Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Undo/Redo */}
        <View style={styles.toolGroup}>
          <TouchableOpacity
            style={[styles.toolButton, !canUndo && styles.toolButtonDisabled]}
            onPress={onUndo}
            disabled={!canUndo}
          >
            <Ionicons
              name="arrow-undo"
              size={22}
              color={canUndo ? colors.text : colors.textTertiary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolButton, !canRedo && styles.toolButtonDisabled]}
            onPress={onRedo}
            disabled={!canRedo}
          >
            <Ionicons
              name="arrow-redo"
              size={22}
              color={canRedo ? colors.text : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        <View style={[styles.separator, { backgroundColor: colors.border }]} />

        {/* Current Tool Button */}
        <TouchableOpacity
          style={[
            styles.currentToolButton,
            { backgroundColor: colors.primaryLight, borderColor: colors.primary },
          ]}
          onPress={() => setShowToolsModal(true)}
        >
          <Ionicons
            name={currentTool?.icon as any || 'hand-left-outline'}
            size={22}
            color={colors.primary}
          />
          <Text style={[styles.currentToolLabel, { color: colors.primary }]}>
            {currentTool?.label || 'Outil'}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.primary} />
        </TouchableOpacity>

        <View style={[styles.separator, { backgroundColor: colors.border }]} />

        {/* Color Picker */}
        <TouchableOpacity
          style={styles.colorButton}
          onPress={() => setShowColorModal(true)}
        >
          <View style={[styles.colorPreview, { backgroundColor: activeColor }]} />
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Stroke Width */}
        <TouchableOpacity
          style={styles.strokeButton}
          onPress={() => setShowStrokeModal(true)}
        >
          <View
            style={[
              styles.strokePreview,
              { backgroundColor: colors.text, height: strokeWidth },
            ]}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Save Button */}
        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: isModified ? colors.primary : colors.backgroundSecondary },
          ]}
          onPress={onSave}
          disabled={!isModified || isSaving}
        >
          {isSaving ? (
            <Ionicons name="hourglass" size={20} color="#fff" />
          ) : (
            <>
              <Ionicons
                name="save"
                size={20}
                color={isModified ? '#fff' : colors.textTertiary}
              />
              <Text
                style={[
                  styles.saveButtonText,
                  { color: isModified ? '#fff' : colors.textTertiary },
                ]}
              >
                Sauver
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Tools Modal */}
      <Modal
        visible={showToolsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowToolsModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowToolsModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Outils
            </Text>

            <View style={styles.toolsGrid}>
              {tools.map((tool) => (
                <TouchableOpacity
                  key={tool.id}
                  style={[
                    styles.toolGridItem,
                    { backgroundColor: colors.background },
                    activeTool === tool.id && {
                      backgroundColor: colors.primaryLight,
                      borderColor: colors.primary,
                    },
                  ]}
                  onPress={() => {
                    onToolChange(tool.id);
                    setShowToolsModal(false);
                  }}
                >
                  <Ionicons
                    name={tool.icon as any}
                    size={28}
                    color={activeTool === tool.id ? colors.primary : colors.text}
                  />
                  <Text
                    style={[
                      styles.toolGridLabel,
                      { color: activeTool === tool.id ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {tool.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Color Modal */}
      <Modal
        visible={showColorModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowColorModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowColorModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Couleur
            </Text>

            <View style={styles.colorGrid}>
              {toolColors.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorGridItem,
                    { backgroundColor: color },
                    activeColor === color && styles.colorGridItemSelected,
                  ]}
                  onPress={() => {
                    onColorChange(color);
                    setShowColorModal(false);
                  }}
                >
                  {activeColor === color && (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={color === '#FFFFFF' ? '#000' : '#fff'}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Stroke Width Modal */}
      <Modal
        visible={showStrokeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStrokeModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowStrokeModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Epaisseur du trait
            </Text>

            <View style={styles.strokeGrid}>
              {strokeWidths.map((width) => (
                <TouchableOpacity
                  key={width}
                  style={[
                    styles.strokeGridItem,
                    { borderColor: colors.border },
                    strokeWidth === width && {
                      backgroundColor: colors.primaryLight,
                      borderColor: colors.primary,
                    },
                  ]}
                  onPress={() => {
                    onStrokeWidthChange(width);
                    setShowStrokeModal(false);
                  }}
                >
                  <View
                    style={[
                      styles.strokeGridPreview,
                      {
                        backgroundColor: strokeWidth === width ? colors.primary : colors.text,
                        height: width,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.strokeGridLabel,
                      { color: strokeWidth === width ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {width}px
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    gap: Spacing.xs,
  },
  toolGroup: {
    flexDirection: 'row',
    gap: 2,
  },
  toolButton: {
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  toolButtonDisabled: {
    opacity: 0.4,
  },
  separator: {
    width: 1,
    height: 28,
    marginHorizontal: Spacing.xs,
  },
  currentToolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  currentToolLabel: {
    fontSize: Typography.sm,
    fontWeight: '500',
  },
  colorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  colorPreview: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  strokeButton: {
    width: 40,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  strokePreview: {
    width: 30,
    borderRadius: 4,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  saveButtonText: {
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxWidth: 360,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  toolGridItem: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolGridLabel: {
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  colorGridItem: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  colorGridItemSelected: {
    borderColor: '#000',
    borderWidth: 3,
  },
  strokeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  strokeGridItem: {
    width: 70,
    height: 60,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.sm,
  },
  strokeGridPreview: {
    width: 40,
    borderRadius: 4,
  },
  strokeGridLabel: {
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
  },
});

export default EditorToolbar;
