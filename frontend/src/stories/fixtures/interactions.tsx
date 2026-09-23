/**
 * Tiny "play-style" DOM interaction helpers for screen stories whose target
 * state (a drawer/panel) is local component state with no route or prop
 * seam to force it open from outside (thread panel, pinned drawer, mobile
 * member list, a composer's file input / textarea). Each renders nothing;
 * `ClickOnMount` polls for a matching element and clicks it once found, so
 * it tolerates the backdrop screen still loading data.
 *
 * This is sandbox-only glue (never imported by app code) — see the design
 * doc's "drive it from the story" guidance. DOM query/mutation helpers live
 * in `domQueries.ts` (kept separate so this file only exports components).
 */
import React, { useEffect } from 'react';
import { attachFakeFile, typeIntoTextarea } from './domQueries';

export interface ClickOnMountProps {
  find: () => HTMLElement | null | undefined;
  timeoutMs?: number;
  pollMs?: number;
}

export const ClickOnMount: React.FC<ClickOnMountProps> = ({ find, timeoutMs = 4000, pollMs = 150 }) => {
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    function tryClick() {
      if (cancelled) return;
      const el = find();
      if (el) {
        el.click();
        return;
      }
      if (Date.now() - start < timeoutMs) {
        setTimeout(tryClick, pollMs);
      }
    }
    tryClick();
    return () => {
      cancelled = true;
    };
  }, [find, timeoutMs, pollMs]);
  return null;
};

/** `ClickOnMount`-style helper that attaches a fake file once the composer's file input exists. */
export const AttachFileOnMount: React.FC<{ filename: string; type: string; timeoutMs?: number }> = ({
  filename,
  type,
  timeoutMs = 4000,
}) => <ClickOnMount find={() => (attachFakeFile(filename, type) ? (document.body as HTMLElement) : null)} timeoutMs={timeoutMs} />;

/** `ClickOnMount`-style helper that types multi-line text into the first `<textarea>` once it exists. */
export const TypeIntoTextareaOnMount: React.FC<{ text: string; timeoutMs?: number }> = ({ text, timeoutMs = 4000 }) => (
  <ClickOnMount find={() => (typeIntoTextarea(text) ? (document.body as HTMLElement) : null)} timeoutMs={timeoutMs} />
);
