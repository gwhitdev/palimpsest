const ACTIVE_PROJECT_STORAGE_KEY = "palimpsest.activeProjectId";

export function getActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
  return value && value.trim().length > 0 ? value : null;
}

export function setActiveProjectId(projectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);
}

export function withProjectQuery(path: string, projectId: string | null | undefined): string {
  if (!projectId) return path;

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}projectId=${encodeURIComponent(projectId)}`;
}
