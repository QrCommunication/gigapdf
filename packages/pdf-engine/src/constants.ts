/** PDF points per inch (1 inch = 72 PDF points) */
export const POINTS_PER_INCH = 72;

/** Default page width in points (US Letter = 8.5 inches) */
export const DEFAULT_PAGE_WIDTH = 612;

/** Default page height in points (US Letter = 11 inches) */
export const DEFAULT_PAGE_HEIGHT = 792;

/** A4 page width in points (210mm) */
export const A4_PAGE_WIDTH = 595.28;

/** A4 page height in points (297mm) */
export const A4_PAGE_HEIGHT = 841.89;

/** Maximum DPI for preview rendering */
export const MAX_PREVIEW_DPI = 300;

/** Default DPI for preview rendering */
export const DEFAULT_PREVIEW_DPI = 150;

/** Default thumbnail max width */
export const DEFAULT_THUMBNAIL_WIDTH = 200;

/** Default thumbnail max height */
export const DEFAULT_THUMBNAIL_HEIGHT = 300;

/** Default JPEG quality for previews */
export const DEFAULT_JPEG_QUALITY = 85;

/** Maximum file size for in-memory processing (100MB) */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Session cleanup interval (60 seconds) */
export const CLEANUP_INTERVAL_MS = 60_000;

/** Default session timeout (30 minutes) */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
