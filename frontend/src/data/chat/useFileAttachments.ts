/**
 * useFileAttachments Hook
 *
 * Shared file attachment logic for MessageInput components.
 * Handles file selection, image previews, file removal, and validation.
 */

import { useState, useCallback, useEffect, useRef } from "react";
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
  const [filePreviews, setFilePreviews] = useState<Map<number, string>>(new Map());
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileCountRef = useRef(0);

  // Cleanup file previews on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      setFilePreviews(new Map());
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

    const startIndex = fileCountRef.current;

    // Generate previews for image files
    files.forEach((file, idx) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            setFilePreviews(prev => new Map(prev).set(startIndex + idx, e.target!.result as string));
          }
        };
        reader.readAsDataURL(file);
      }
    });

    fileCountRef.current += files.length;
    setSelectedFiles(prev => [...prev, ...files]);
    return true;
  }, [maxFileSize]);

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
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setFilePreviews(prev => {
      const newPreviews = new Map(prev);
      newPreviews.delete(index);
      return newPreviews;
    });
  }, []);

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const clearFiles = useCallback(() => {
    fileCountRef.current = 0;
    setSelectedFiles([]);
    setFilePreviews(new Map());
  }, []);

  return {
    selectedFiles,
    filePreviews,
    fileInputRef,
    handleFileSelect,
    handleFileDrop,
    handleRemoveFile,
    handleFileButtonClick,
    clearFiles,
    validationError,
    clearValidationError,
  };
}
