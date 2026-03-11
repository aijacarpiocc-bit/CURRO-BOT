import { ChatMessage } from "../types.js";
import { logger } from "../../shared/logger.js";
import { FirestoreMemoryStore } from "./firestore.js";
import { SqliteMemoryStore } from "./sqlite.js";
import { MemoryNote, StoredMessage } from "./types.js";

export class MemoryService {
  public constructor(
    private readonly localStore: SqliteMemoryStore,
    private readonly cloudStore?: FirestoreMemoryStore,
  ) {}

  public async saveConversationMessage(chatId: string, message: ChatMessage): Promise<void> {
    this.localStore.saveMessage(chatId, message);
    await this.tryCloudOperation(() => this.cloudStore?.saveMessage(chatId, message));
  }

  public async maybeStoreExplicitMemory(chatId: string, userText: string): Promise<void> {
    const text = userText.trim();
    if (!text) {
      return;
    }

    const memoryCandidate = extractMemoryCandidate(text);
    if (!memoryCandidate) {
      return;
    }

    this.localStore.saveNote(chatId, memoryCandidate);
    await this.tryCloudOperation(() => this.cloudStore?.saveNote(chatId, memoryCandidate));
  }

  public async buildContext(chatId: string): Promise<{ history: ChatMessage[]; notes: string[] }> {
    const localHistory = this.localStore.getRecentMessages(chatId);
    const cloudHistory = await this.tryCloudOperation(
      () => this.cloudStore?.getRecentMessages(chatId, 20),
      [],
    );
    const localNotes = this.localStore.getRecentNotes(chatId);
    const cloudNotes = await this.tryCloudOperation(
      () => this.cloudStore?.getRecentNotes(chatId, 12),
      [],
    );

    const history = dedupeMessages([...localHistory, ...cloudHistory]).map<ChatMessage>((message) => ({
      role: message.role,
      content: message.content,
    }));

    const notes = dedupeNotes([...localNotes, ...cloudNotes]).map((note) => note.content);

    return { history, notes };
  }

  private async tryCloudOperation<T>(operation: () => Promise<T> | undefined, fallback?: T): Promise<T> {
    try {
      if (!this.cloudStore?.isEnabled()) {
        return fallback as T;
      }

      const result = await operation();
      return (result ?? fallback) as T;
    } catch (error) {
      logger.warn("Operacion de Firestore fallida. Se mantiene memoria local.");
      logger.debug(String(error));
      return fallback as T;
    }
  }
}

function extractMemoryCandidate(text: string): string | null {
  const lower = text.toLowerCase();

  const prefixes = [
    "recuerda que ",
    "mi nombre es ",
    "me llamo ",
    "soy ",
    "trabajo en ",
    "vivo en ",
    "prefiero ",
  ];

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return prefix === "recuerda que " ? text.slice(prefix.length).trim() : text;
    }
  }

  return null;
}

function dedupeMessages(messages: StoredMessage[]): StoredMessage[] {
  const unique = new Map<string, StoredMessage>();

  for (const message of messages) {
    const key = `${message.createdAt}|${message.role}|${message.content}`;
    unique.set(key, message);
  }

  return Array.from(unique.values())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-20);
}

function dedupeNotes(notes: MemoryNote[]): MemoryNote[] {
  const unique = new Map<string, MemoryNote>();

  for (const note of notes) {
    unique.set(note.content.toLowerCase(), note);
  }

  return Array.from(unique.values())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-12);
}
