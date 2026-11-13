import { useEffect } from 'react';
import { useElectronAPI } from '../contexts/ElectronContext';

/**
 * Desktop app: a file dragged onto the window anywhere but a drop zone (the
 * message input's) is refused, instead of Chromium opening it in the window.
 * A page opened that way would replace the app (main also blocks the
 * navigation; this keeps the window from trying). Drop zones call
 * preventDefault themselves, so an event they handled is left alone.
 */
export function useBlockWindowDrops(): void {
  const electronAPI = useElectronAPI();

  useEffect(() => {
    if (!electronAPI) return;
    const onDragOver = (event: DragEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (event: DragEvent) => {
      if (!event.defaultPrevented) event.preventDefault();
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [electronAPI]);
}
