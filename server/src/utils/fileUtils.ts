/**
 * Extracts the file extension from a filename, including the leading dot.
 * Returns '.bin' if no extension is found.
 * @param filename The name of the file.
 * @returns The file extension (e.g., '.txt', '.jpg').
 */
export function getFileExtension(filename: string): string {
  if (!filename) return '.bin';
  return '.' + (filename.split('.').pop()?.toLowerCase() || 'bin');
}
