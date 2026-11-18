export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 0 ? "Vacío" : `${count} ${count === 1 ? singular : plural}`;
}
