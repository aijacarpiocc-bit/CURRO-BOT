import fs from "node:fs";
import path from "node:path";
import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { AppConfig } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { ChatMessage } from "../types.js";
import { MemoryNote, StoredMessage } from "./types.js";

export class FirestoreMemoryStore {
  private readonly app?: App;
  private readonly db?: Firestore;
  private readonly enabled: boolean;
  private readonly rootCollection: string;

  public constructor(config: AppConfig) {
    this.rootCollection = config.firestoreRootCollection;

    const credentialsPath = config.googleApplicationCredentials;
    if (!credentialsPath) {
      logger.warn("Firestore desactivado: falta GOOGLE_APPLICATION_CREDENTIALS.");
      this.enabled = false;
      return;
    }

    const resolvedPath = path.resolve(credentialsPath);
    if (!fs.existsSync(resolvedPath)) {
      logger.warn(`Firestore desactivado: no existe ${resolvedPath}.`);
      this.enabled = false;
      return;
    }

    try {
      this.app =
        getApps()[0] ??
        initializeApp({
          credential: this.loadCredential(resolvedPath),
        });
      this.db = getFirestore(this.app);
      this.enabled = true;
    } catch (error) {
      logger.error("No se pudo inicializar Firestore. Se usara solo memoria local.", error);
      this.enabled = false;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async saveMessage(chatId: string, message: ChatMessage): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection(this.rootCollection).doc(chatId).collection("messages").add({
      role: message.role,
      content: message.content,
      createdAt: new Date().toISOString(),
    });
  }

  public async getRecentMessages(chatId: string, limit = 20): Promise<StoredMessage[]> {
    if (!this.db) {
      return [];
    }

    const snapshot = await this.db
      .collection(this.rootCollection)
      .doc(chatId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => doc.data())
      .map((data) => ({
        role: typeof data.role === "string" ? (data.role as ChatMessage["role"]) : "user",
        content: typeof data.content === "string" ? data.content : "",
        createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date(0).toISOString(),
      }))
      .filter((item) => item.content)
      .reverse();
  }

  public async saveNote(chatId: string, content: string): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection(this.rootCollection).doc(chatId).collection("notes").add({
      content,
      createdAt: new Date().toISOString(),
    });
  }

  public async getRecentNotes(chatId: string, limit = 12): Promise<MemoryNote[]> {
    if (!this.db) {
      return [];
    }

    const snapshot = await this.db
      .collection(this.rootCollection)
      .doc(chatId)
      .collection("notes")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => doc.data())
      .map((data) => ({
        content: typeof data.content === "string" ? data.content : "",
        createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date(0).toISOString(),
      }))
      .filter((item) => item.content)
      .reverse();
  }

  private loadCredential(resolvedPath: string) {
    try {
      const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as Record<string, unknown>;
      return cert(parsed);
    } catch {
      return applicationDefault();
    }
  }
}
