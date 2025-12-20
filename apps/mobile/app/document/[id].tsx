/**
 * Document Detail Screen
 * Displays a single document with actions
 */

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography } from '../../src/constants/spacing';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Document',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>
            Document #{id}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Chargement du document...
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
