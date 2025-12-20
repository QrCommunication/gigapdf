/**
 * Tool Screen
 * Displays a specific PDF tool interface
 */

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography } from '../../src/constants/spacing';

// Tool name mapping
const toolNames: Record<string, string> = {
  merge: 'Fusionner PDF',
  split: 'Diviser PDF',
  compress: 'Compresser PDF',
  convert: 'Convertir en PDF',
  export: 'Exporter PDF',
  rotate: 'Pivoter PDF',
  watermark: 'Filigrane',
  protect: 'Proteger PDF',
  unlock: 'Deverrouiller PDF',
  ocr: 'OCR - Reconnaissance',
  sign: 'Signer PDF',
};

export default function ToolScreen() {
  const { tool } = useLocalSearchParams<{ tool: string }>();
  const { colors } = useTheme();

  const toolName = toolNames[tool || ''] || tool || 'Outil';

  return (
    <>
      <Stack.Screen
        options={{
          title: toolName,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>
            {toolName}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Outil en cours de chargement...
          </Text>
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.md,
    marginBottom: Spacing.lg,
  },
  loader: {
    marginTop: Spacing.md,
  },
});
