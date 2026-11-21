/** The files among a clipboard's items (pasted screenshots, copied files); [] for none. */
export function clipboardFiles(data: DataTransfer | null | undefined): File[] {
  const items = data?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
