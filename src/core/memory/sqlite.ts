import Database from "better-sqlite3";
import { ChatMessage } from "../types.js";
import { MemoryNote, StoredMessage } from "./types.js";

export class SqliteMemoryStore {
  private readonly db: Database.Database;

  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memory_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_notes_chat_id ON memory_notes(chat_id, id DESC);
    `);
  }

  public saveMessage(chatId: string, message: ChatMessage): void {
    const statement = this.db.prepare(`
      INSERT INTO chat_messages (chat_id, role, content)
      VALUES (@chatId, @role, @content)
    `);

    statement.run({
      chatId,
      role: message.role,
      content: message.content,
    });
  }

  public getRecentMessages(chatId: string, limit = 12): StoredMessage[] {
    const statement = this.db.prepare(`
      SELECT role, content, created_at AS createdAt
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);

    return statement.all(chatId, limit).reverse() as StoredMessage[];
  }

  public saveNote(chatId: string, content: string): void {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }

    const statement = this.db.prepare(`
      INSERT INTO memory_notes (chat_id, content)
      VALUES (?, ?)
    `);

    statement.run(chatId, normalized);
  }

  public getRecentNotes(chatId: string, limit = 8): MemoryNote[] {
    const statement = this.db.prepare(`
      SELECT content, created_at AS createdAt
      FROM memory_notes
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);

    return statement.all(chatId, limit).reverse() as MemoryNote[];
  }
}
