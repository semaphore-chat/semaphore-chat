/**
 * useFileAttachments Hook
 *
 * Shared file attachment logic for MessageInput components.
 * Handles file selection, image previews, file removal, and validation.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { instanceControllerGetPublicSettingsOptions } from "../../api-client/@tanstack/react-query.gen";
import { MAX_FILE_SIZE, MAX_FILES_PER_MESSAGE } from "../../constants/messages";
import { formatFileSize } from "../../utils/format";

export interface UseFileAttachmentsReturn {
  selectedFiles: File[];
  filePreviews: Map<number, string>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleFileDrop: (files: File[]) => void;
  handleRemoveFile: (index: number) => void;
  handleFileButtonClick: () => void;
  clearFiles: () => void;
  /** Takes these files (by identity) out of the queue, leaving any added since. */
  removeFiles: (files: readonly File[]) => void;
  validationError: string | null;
  clearValidationError: () => void;
}

/**
 * Custom hook for managing file attachments in message inputs
 */
export function useFileAttachments(): UseFileAttachmentsReturn {
  const { data: publicSettings } = useQuery(instanceControllerGetPublicSettingsOptions());
  const maxFileSize = publicSettings?.maxFileSizeBytes ?? MAX_FILE_SIZE;

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Each preview belongs to its file, not to a position: removing a middle file (or adding one later) must not
  // hand a remaining file another file's preview, or none (#827). `filePreviews` is derived by position. A preview is
  // an object URL of the local file, released when its file is removed, the files are cleared or the composer goes.
  const [previewByFile, setPreviewByFile] = useState<Map<File, string>>(new Map());
  const previewsRef = useRef<Map<File, string>>(new Map());
  const selectedRef = useRef<File[]>([]);
  const setPreviews = useCallback((next: Map<File, string>) => {
    previewsRef.current = next;
    setPreviewByFile(next);
  }, []);
  const setSelected = useCallback((next: File[]) => {
    selectedRef.current = next;
    setSelectedFiles(next);
  }, []);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileCountRef = useRef(0);

  // Release the previews on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewsRef.current = new Map();
      selectedRef.current = [];
      setPreviewByFile(new Map());
      setSelectedFiles([]);
    };
  }, []);

  const clearValidationError = useCallback(() => {
    setValidationError(null);
  }, []);

  /** Shared validation + preview generation + state update for new files */
  const addFiles = useCallback((files: File[]): boolean => {
    if (files.length === 0) return false;

    // Validate file sizes
    const oversizedFile = files.find(file => file.size > maxFileSize);
    if (oversizedFile) {
      setValidationError(`File "${oversizedFile.name}" exceeds the ${formatFileSize(maxFileSize)} size limit`);
      return false;
    }

    // Validate total file count
    if (fileCountRef.current + files.length > MAX_FILES_PER_MESSAGE) {
      setValidationError(`Maximum ${MAX_FILES_PER_MESSAGE} files per message`);
      return false;
    }

    // Previews for image files: object URLs of the local files (made at once, so none can arrive late).
    if (typeof URL.createObjectURL === 'function') {
      const next = new Map(previewsRef.current);
      files.forEach((file) => {
        if (file.type.startsWith('image/') && !next.has(file)) next.set(file, URL.createObjectURL(file));
      });
      if (next.size !== previewsRef.current.size) setPreviews(next);
    }

    fileCountRef.current += files.length;
    setSelected([...selectedRef.current, ...files]);
    return true;
  }, [maxFileSize, setPreviews, setSelected]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      addFiles(Array.from(files));
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addFiles]);

  const handleFileDrop = useCallback((files: File[]) => {
    addFiles(files);
  }, [addFiles]);

  const handleRemoveFile = useCallback((index: number) => {
    fileCountRef.current = Math.max(0, fileCountRef.current - 1);
    const removed = selectedRef.current[index];
    const rest = selectedRef.current.filter((_, i) => i !== index);
    setSelected(rest);
    // Its preview is released, unless the same file is still queued.
    const url = removed === undefined ? undefined : previewsRef.current.get(removed);
    if (removed !== undefined && url !== undefined && !rest.includes(removed)) {
      URL.revokeObjectURL(url);
      const next = new Map(previewsRef.current);
      next.delete(removed);
      setPreviews(next);
    }
  }, [setPreviews, setSelected]);

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const clearFiles = useCallback(() => {
    fileCountRef.current = 0;
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    setSelected([]);
    setPreviews(new Map());
  }, [setPreviews, setSelected]);

  const removeFiles = useCallback((files: readonly File[]) => {
    const gone = new Set(files);
    const rest = selectedRef.current.filter((file) => !gone.has(file));
    fileCountRef.current = rest.length;
    setSelected(rest);
    const next = new Map(previewsRef.current);
    for (const file of gone) {
      const url = next.get(file);
      if (url !== undefined && !rest.includes(file)) {
        URL.revokeObjectURL(url);
        next.delete(file);
      }
    }
    setPreviews(next);
  }, [setPreviews, setSelected]);

  const filePreviews = useMemo(() => {
    const byIndex = new Map<number, string>();
    selectedFiles.forEach((file, i) => {
      const preview = previewByFile.get(file);
      if (preview !== undefined) byIndex.set(i, preview);
    });
    return byIndex;
  }, [selectedFiles, previewByFile]);

  return {
    selectedFiles,
    filePreviews,
    fileInputRef,
    handleFileSelect,
    handleFileDrop,
    handleRemoveFile,
    handleFileButtonClick,
    clearFiles,
    removeFiles,
    validationError,
    clearValidationError,
  };
}
