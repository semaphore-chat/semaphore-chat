import { createContext, useContext } from "react";

/** "Edit this message": raised by ↑ in an empty composer, taken by the message's row. */
export interface EditRequest {
  messageId: string;
  /** Distinguishes repeated requests for the same message. */
  seq: number;
}

export interface EditRequestContextValue {
  request: EditRequest | null;
  /** The row calls this once it has opened its edit form. */
  clear: (seq: number) => void;
}

export const EditRequestContext = createContext<EditRequestContextValue>({
  request: null,
  clear: () => {},
});

export function useEditRequest(): EditRequestContextValue {
  return useContext(EditRequestContext);
}
