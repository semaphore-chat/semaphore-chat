import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileAttachments } from '../../data/chat/useFileAttachments';
import { createTestQueryClient, createTestWrapper } from '../test-utils';
// Mock the generated query options to return a controlled maxFileSizeBytes
const mockPublicSettings = { registrationMode: 'OPEN', maxFileSizeBytes: 500 * 1024 * 1024 }; // 500MB

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  instanceControllerGetPublicSettingsOptions: () => ({
    queryKey: ['instanceControllerGetPublicSettings'],
    queryFn: () => Promise.resolve(mockPublicSettings),
  }),
}));

let queryClient: ReturnType<typeof createTestQueryClient>;

beforeEach(() => {
  queryClient = createTestQueryClient();
});

function renderFileAttachments() {
  return renderHook(() => useFileAttachments(), {
    wrapper: createTestWrapper({ queryClient }),
  });
}

function createMockFile(name: string, size: number, type = 'text/plain'): File {
  const content = new Uint8Array(Math.min(size, 100)); // Don't allocate huge arrays
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('useFileAttachments', () => {
  describe('with server-configured limit', () => {
    it('accepts files under the server-configured limit', async () => {
      const { result } = renderFileAttachments();

      // Wait for query to settle
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const file = createMockFile('doc.pdf', 100 * 1024 * 1024); // 100MB - under 500MB limit
      act(() => {
        result.current.handleFileDrop([file]);
      });

      expect(result.current.selectedFiles).toHaveLength(1);
      expect(result.current.validationError).toBeNull();
    });

    it('rejects files over the server-configured limit', async () => {
      const { result } = renderFileAttachments();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const file = createMockFile('huge.zip', 600 * 1024 * 1024); // 600MB - over 500MB limit
      act(() => {
        result.current.handleFileDrop([file]);
      });

      expect(result.current.selectedFiles).toHaveLength(0);
      expect(result.current.validationError).toBe(
        'File "huge.zip" exceeds the 500 MB size limit',
      );
    });

    it('uses dynamic limit in error message, not hardcoded 10MB', async () => {
      const { result } = renderFileAttachments();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const file = createMockFile('big.mp4', 600 * 1024 * 1024);
      act(() => {
        result.current.handleFileDrop([file]);
      });

      expect(result.current.validationError).not.toContain('10MB');
      expect(result.current.validationError).toContain('500 MB');
    });
  });

  describe('handleFileSelect', () => {
    it('rejects oversized files via file input', async () => {
      const { result } = renderFileAttachments();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const file = createMockFile('too-big.zip', 600 * 1024 * 1024);
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      act(() => {
        result.current.handleFileSelect(event);
      });

      expect(result.current.selectedFiles).toHaveLength(0);
      expect(result.current.validationError).toContain('500 MB');
    });
  });

  describe('clearValidationError', () => {
    it('clears the validation error', async () => {
      const { result } = renderFileAttachments();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const file = createMockFile('big.zip', 600 * 1024 * 1024);
      act(() => {
        result.current.handleFileDrop([file]);
      });

      expect(result.current.validationError).not.toBeNull();

      act(() => {
        result.current.clearValidationError();
      });

      expect(result.current.validationError).toBeNull();
    });
  });

  describe('file management', () => {
    it('adds and removes files', async () => {
      const { result } = renderFileAttachments();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const file1 = createMockFile('a.txt', 100);
      const file2 = createMockFile('b.txt', 200);

      act(() => {
        result.current.handleFileDrop([file1, file2]);
      });

      expect(result.current.selectedFiles).toHaveLength(2);

      act(() => {
        result.current.handleRemoveFile(0);
      });

      expect(result.current.selectedFiles).toHaveLength(1);
    });

    it('clears all files', async () => {
      const { result } = renderFileAttachments();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      act(() => {
        result.current.handleFileDrop([createMockFile('a.txt', 100)]);
      });

      expect(result.current.selectedFiles).toHaveLength(1);

      act(() => {
        result.current.clearFiles();
      });

      expect(result.current.selectedFiles).toHaveLength(0);
    });
      // #827: previews were keyed by index, so removing a middle file left the next file showing no preview (or
    // the removed one's), and a file added afterwards could take a stale slot.
    it('removing a middle file keeps each remaining file with its own preview', async () => {
      const { result } = renderFileAttachments();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      const files = ['a.png', 'b.png', 'c.png'].map((name) => new File([name], name, { type: 'image/png' }));
      act(() => {
        result.current.handleFileDrop(files);
      });
      // FileReader is real in jsdom: wait for the three data URLs.
      await vi.waitFor(() => expect(result.current.filePreviews.size).toBe(3));
      const previewOf = (name: string) => {
        const i = result.current.selectedFiles.findIndex((f) => f.name === name);
        return result.current.filePreviews.get(i);
      };
      const cBefore = previewOf('c.png');
      const aBefore = previewOf('a.png');
      expect(cBefore).toBeDefined();

      act(() => {
        result.current.handleRemoveFile(1);
      });
      expect(result.current.selectedFiles.map((f) => f.name)).toEqual(['a.png', 'c.png']);
      expect(previewOf('a.png')).toBe(aBefore);
      expect(previewOf('c.png')).toBe(cBefore);

      // A file added after the removal gets its own preview, and the others keep theirs.
      act(() => {
        result.current.handleFileDrop([new File(['d.png'], 'd.png', { type: 'image/png' })]);
      });
      await vi.waitFor(() => expect(previewOf('d.png')).toBeDefined());
      expect(previewOf('c.png')).toBe(cBefore);
      expect(previewOf('d.png')).not.toBe(cBefore);
      expect(result.current.filePreviews.size).toBe(3);
    });
});
});
