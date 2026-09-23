import { createContext } from "react";
import type { Room } from "livekit-client";

export interface RoomContextType {
  room: Room | null;
  setRoom: (room: Room | null) => void;
  getRoom: () => Room | null;
}

export const RoomContext = createContext<RoomContextType | null>(null);
