/**
 * POST /file-upload with upload progress and cancellation.
 *
 * fetch() can't report upload progress, so this uses XMLHttpRequest (the
 * generated API client and hooks/useFileUpload.ts use fetch). An expired
 * access token is refreshed once and the upload retried, like the API
 * client's 401 interceptor does (see api-client-config.ts).
 */
import { getApiUrl } from "../config/env";
import { getAccessToken, refreshSessionWithRetry } from "./tokenService";
import type { ResourceType } from "../hooks/useFileUpload";

export interface UploadedFileDto {
  id: string;
  filename: string;
  mimeType: string;
  fileType: string;
  size: number;
}

export interface UploadFileWithProgressOptions {
  resourceType: ResourceType;
  resourceId?: string | null;
  /** Called with the fraction of the request body sent so far (0..1). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Thrown when the upload was cancelled through `signal`. */
export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

export class UploadHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadHttpError";
  }
}

function errorMessageFrom(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (Array.isArray(body.message) && typeof body.message[0] === "string") return body.message[0];
  } catch {
    // not JSON
  }
  return `Upload failed with status ${xhr.status}`;
}

function sendOnce(file: File, options: UploadFileWithProgressOptions, token: string): Promise<UploadedFileDto> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("resourceType", options.resourceType);
    if (options.resourceId !== undefined) {
      form.append("resourceId", options.resourceId || "");
    }

    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
    options.signal?.addEventListener("abort", onAbort);

    xhr.open("POST", getApiUrl("/file-upload"));
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          options.onProgress?.(1);
          resolve(JSON.parse(xhr.responseText) as UploadedFileDto);
        } catch {
          reject(new UploadHttpError("Upload failed: unreadable response", xhr.status));
        }
        return;
      }
      reject(new UploadHttpError(errorMessageFrom(xhr), xhr.status));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Network error while uploading"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadAbortedError());
    };
    xhr.send(form);
  });
}

export async function uploadFileWithProgress(
  file: File,
  options: UploadFileWithProgressOptions,
): Promise<UploadedFileDto> {
  const token = getAccessToken();
  if (!token) throw new Error("No authentication token found");
  try {
    return await sendOnce(file, options, token);
  } catch (error) {
    if (!(error instanceof UploadHttpError) || error.status !== 401) throw error;
    // The token expired mid-upload (a big file on a slow link): another
    // request may have refreshed it already; otherwise refresh once.
    const current = getAccessToken();
    let retryToken: string | null = current && current !== token ? current : null;
    if (!retryToken) {
      const result = await refreshSessionWithRetry();
      if (result.status !== "refreshed") throw error;
      retryToken = result.token;
    }
    options.onProgress?.(0);
    return sendOnce(file, options, retryToken);
  }
}
