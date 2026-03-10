import { ExpoConfig, ConfigContext } from "expo/config";

// Read version from package.json - single source of truth
const packageJson = require("./package.json");

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "GigaPDF",
  slug: "gigapdf-mobile",
  version: packageJson.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  scheme: "gigapdf",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#1a1a1a",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.gigapdf.mobile",
    buildNumber: packageJson.version,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#1a1a1a",
    },
    package: "com.gigapdf.mobile",
    edgeToEdgeEnabled: true,
    permissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
    ],
    versionCode: getVersionCode(packageJson.version),
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },
  plugins: [
    [
      "expo-router",
      {
        origin: "https://giga-pdf.com",
      },
    ],
    "expo-secure-store",
    "expo-font",
    "expo-web-browser",
    [
      "expo-document-picker",
      {
        iCloudContainerEnvironment: "Production",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "L'application a besoin d'accéder à vos photos pour les convertir en PDF.",
        cameraPermission:
          "L'application a besoin d'accéder à votre caméra pour scanner des documents.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appVersion: packageJson.version,
    router: {
      origin: "https://giga-pdf.com",
    },
    googleOAuth: {
      clientId:
        "181209330808-4jjrhkd8baia69p2huvt1ae3idc6k47b.apps.googleusercontent.com",
      webClientId:
        "181209330808-a6t1cgnpm0klvdumkdg3o8u38i1f8fb6.apps.googleusercontent.com",
    },
    eas: {
      projectId: "a94261ac-fa8e-4b12-9807-281161643485",
    },
  },
  owner: "ronylicha",
});

/**
 * Convert semantic version to Android versionCode
 * Format: MAJOR * 10000 + MINOR * 100 + PATCH
 * Example: 0.5.0 -> 500, 1.2.3 -> 10203
 */
function getVersionCode(version: string): number {
  const cleanVersion = version.replace(/-.*$/, ""); // Remove -alpha, -beta, etc.
  const parts = cleanVersion.split(".").map(Number);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  return major * 10000 + minor * 100 + patch;
}
