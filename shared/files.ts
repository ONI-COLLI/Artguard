export const productFileAccept = '.png,.jpg,.jpeg,.webp,.pdf,.zip';
export const maxProductFileBytes = 20 * 1024 * 1024;
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
