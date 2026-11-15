import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-only-secret-change-me-please';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().default('postgres://amt:amt@localhost:5432/amt'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CHROMA_URL: z.string().url().default('http://localhost:8000'),
  CHROMA_COLLECTION: z.string().default('amt_chunks'),

  // Embeddings: a multilingual model served by Ollama.
  OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  EMBEDDING_MODEL: z.string().default('bge-m3'),

  // Generation: an OpenAI-compatible llm-gateway. Without a gateway, Ollama /v1.
  LLM_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
  LLM_API_KEY: z.string().default('ollama'),
  LLM_MODEL: z.string().default('qwen3.5:9b'),
  LLM_REWRITE_MODEL: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(120_000),
  // For reasoning models (qwen3.x and similar), `none` turns reasoning off:
  // with qwen3.5:9b the query rewrite takes ~1 s instead of ~200 s.
  LLM_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high']).optional(),

  JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  ADMIN_EMAIL: z.string().email().default('admin@amt.local'),
  ADMIN_PASSWORD: z.string().min(10).optional(),

  SOURCES_FILE: z.string().default('../../data/sources.yaml'),
  SEARCH_API_KEY: z.string().optional(),

  RETRIEVAL_K: z.coerce.number().int().min(1).max(100).default(20),
  CONTEXT_CHUNKS: z.coerce.number().int().min(1).max(20).default(6),
  // Refusal threshold: cosine similarity of the best vector match.
  MIN_VECTOR_SIMILARITY: z.coerce.number().min(0).max(1).default(0.45),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Empty values count as unset. Docker Compose passes `VAR: ${VAR:-}` as an empty
 * string, and an empty LLM_REWRITE_MODEL used to become a request for model "",
 * which failed and silently fell back to the untranslated question.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const defined = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = schema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** BullMQ takes ioredis options rather than a URL, so REDIS_URL is parsed here. */
export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
