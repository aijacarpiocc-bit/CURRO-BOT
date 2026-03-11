import { ChatMessage } from "../types.js";

export interface StoredMessage {
  role: ChatMessage["role"];
  content: string;
  createdAt: string;
}

export interface MemoryNote {
  content: string;
  createdAt: string;
}
