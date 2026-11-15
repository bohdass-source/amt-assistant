import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { HistoryTurn } from '../rag/prompts';

export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  url: string;
  page: number;
  section: string | null;
  docDate: string;
  dateNote: string | null;
  snippet: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  lang: string | null;
  query_de: string | null;
  citations: Citation[];
  footer: string | null;
  refused: boolean;
  refusal_reason: string | null;
  created_at: string;
  rating?: number | null;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DbService) {}

  async getOrCreate(userId: string, conversationId: string | undefined, firstQuestion: string): Promise<string> {
    if (conversationId) {
      await this.assertOwner(userId, conversationId);
      return conversationId;
    }
    const title = firstQuestion.replace(/\s+/g, ' ').trim().slice(0, 80);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
      [userId, title],
    );
    return row!.id;
  }

  async assertOwner(userId: string, conversationId: string): Promise<void> {
    const row = await this.db.one<{ user_id: string }>(`SELECT user_id FROM conversations WHERE id = $1`, [conversationId]);
    if (!row) throw new NotFoundException('Conversation not found');
    if (row.user_id !== userId) throw new ForbiddenException();
  }

  async history(conversationId: string, limit = 6): Promise<HistoryTurn[]> {
    const rows = await this.db.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [conversationId, limit],
    );
    return rows.reverse();
  }

  async addUserMessage(conversationId: string, content: string): Promise<string> {
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2) RETURNING id`,
      [conversationId, content],
    );
    await this.db.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
    return row!.id;
  }

  async addAssistantMessage(m: {
    conversationId: string;
    content: string;
    lang: string;
    queryDe: string;
    citations: Citation[];
    footer: string;
    refused: boolean;
    refusalReason: string | null;
  }): Promise<string> {
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO messages (conversation_id, role, content, lang, query_de, citations, footer, refused, refusal_reason)
       VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [m.conversationId, m.content, m.lang, m.queryDe, JSON.stringify(m.citations), m.footer, m.refused, m.refusalReason],
    );
    return row!.id;
  }

  list(userId: string) {
    return this.db.query(
      `SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId],
    );
  }

  async messages(userId: string, conversationId: string): Promise<MessageRow[]> {
    await this.assertOwner(userId, conversationId);
    return this.db.query<MessageRow>(
      `SELECT m.*, r.score AS rating
         FROM messages m LEFT JOIN ratings r ON r.message_id = m.id
        WHERE m.conversation_id = $1 ORDER BY m.created_at`,
      [conversationId],
    );
  }

  async remove(userId: string, conversationId: string): Promise<void> {
    await this.assertOwner(userId, conversationId);
    await this.db.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
  }

  async rate(userId: string, messageId: string, score: 1 | -1, comment: string | null): Promise<void> {
    const row = await this.db.one<{ user_id: string; role: string }>(
      `SELECT c.user_id, m.role FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1`,
      [messageId],
    );
    if (!row || row.role !== 'assistant') throw new NotFoundException('Answer not found');
    if (row.user_id !== userId) throw new ForbiddenException();
    await this.db.query(
      `INSERT INTO ratings (message_id, user_id, score, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, created_at = now()`,
      [messageId, userId, score, comment],
    );
  }
}
