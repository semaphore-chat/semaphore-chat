/**
 * The host makes every id: toast ids, layer ids and opener ids
 * (`design/guide/behaviour.md`, "Ids, tokens and numbers").
 */
export interface Ids {
  /** `layer-1`, `layer-2`, ... counted per kind. */
  next(kind: string): string;
  /** The id of an element focus may return to; the same element always gets the same id. */
  forElement(element: Element): string;
}

export function createIds(): Ids {
  const counters = new Map<string, number>();
  const elements = new WeakMap<Element, string>();
  let openers = 0;
  return {
    next(kind) {
      const n = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, n);
      return `${kind}-${n}`;
    },
    forElement(element) {
      let id = elements.get(element);
      if (id === undefined) {
        openers += 1;
        id = `opener-${openers}`;
        elements.set(element, id);
      }
      return id;
    },
  };
}
