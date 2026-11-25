export const ADMIN_BASE_PATH = process.env.NODE_ENV === "production" ? "/admin" : "";

export function withAdminBasePath(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, "");
  return ADMIN_BASE_PATH && !normalized.endsWith(ADMIN_BASE_PATH)
    ? `${normalized}${ADMIN_BASE_PATH}`
    : normalized;
}
