import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks which of a page's sections (by element id) is being read, for a
 * section nav: the first section, in `ids` order, that crosses the top 40% of
 * the viewport. `scrollTo(id)` scrolls a section into view and marks it active
 * right away. The URL is left alone (Electron routes in the hash).
 *
 * Without IntersectionObserver (jsdom) the first section stays active.
 */
export function useScrollSpy(ids: string[]): [string | undefined, (id: string) => void] {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const visible = useRef(new Set<string>());
  const key = ids.join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const order = key.split("|");
    const seen = visible.current;
    seen.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        const first = order.find((id) => seen.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const id of order) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);

  const scrollTo = useCallback((id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);

  return [active, scrollTo];
}
