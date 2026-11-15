/**
 * Migrations live in code so that tsc puts them into dist without copying .sql files.
 * They run in order, each in its own transaction.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'init',
    sql: `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE,
  password_hash text,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_guest      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  url         text NOT NULL,
  publisher   text NOT NULL,
  doc_type    text NOT NULL,
  doc_date    date NOT NULL,
  date_note   text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'queued', 'processing', 'ready', 'failed')),
  sha256      text,
  pages       int,
  chunks      int,
  error       text,
  ingested_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id          text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        int NOT NULL,
  section     text,
  chunk_index int NOT NULL,
  text        text NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (
                to_tsvector('german', coalesce(section, '') || ' ' || text)
              ) STORED
);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_document_idx ON chunks (document_id);

CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  lang            text,
  query_de        text,
  citations       jsonb NOT NULL DEFAULT '[]',
  footer          text,
  refused         boolean NOT NULL DEFAULT false,
  refusal_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE ratings (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      smallint NOT NULL CHECK (score IN (-1, 1)),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
