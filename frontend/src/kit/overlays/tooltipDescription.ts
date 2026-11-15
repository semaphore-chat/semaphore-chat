import { createContext, useContext, useEffect } from 'react';

/**
 * How a Tooltip reaches the control it describes. The Tooltip provides this
 * around its child; a kit control puts `id` into the `aria-describedby` of the
 * element that takes focus (its native input, combobox or button), next to any
 * description of its own. This is internal: there is no public prop.
 */
export interface TooltipDescription {
  /** The tooltip's id while it is showing, else undefined. */
  id: string | undefined;
  /** A control calls this on mount to say it wires the description itself; it returns the release. */
  claim: () => () => void;
}

export const TooltipDescriptionContext = createContext<TooltipDescription | null>(null);

/**
 * The `aria-describedby` for a kit control's focusable element: its own
 * description (helper or error text, say), plus the enclosing Tooltip's while
 * that is showing. Returns undefined when there is neither.
 */
export function useDescribedBy(own: string | undefined): string | undefined {
  const tooltip = useContext(TooltipDescriptionContext);
  const claim = tooltip?.claim;
  useEffect(() => claim?.(), [claim]);
  return joinIds(own, tooltip?.id);
}

/** Space-joins the ids that are set; undefined when none is. */
export function joinIds(...ids: (string | undefined)[]): string | undefined {
  const set = ids.filter((id): id is string => id !== undefined && id !== '');
  return set.length === 0 ? undefined : set.join(' ');
}
