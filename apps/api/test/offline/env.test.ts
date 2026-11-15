import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env';

describe('parseEnv', () => {
  it('treats empty values from Docker Compose as unset', () => {
    // docker-compose.yml passes `LLM_REWRITE_MODEL: ${LLM_REWRITE_MODEL:-}` and so on.
    const e = parseEnv({ LLM_MODEL: 'qwen3.5:9b', LLM_REWRITE_MODEL: '', ADMIN_PASSWORD: '', SEARCH_API_KEY: ' ', LLM_REASONING_EFFORT: '' });

    expect(e.LLM_REWRITE_MODEL).toBeUndefined();
    expect(e.ADMIN_PASSWORD).toBeUndefined();
    expect(e.SEARCH_API_KEY).toBeUndefined();
    expect(e.LLM_REASONING_EFFORT).toBeUndefined();
  });

  it('applies defaults for empty values', () => {
    expect(parseEnv({ MIN_VECTOR_SIMILARITY: '', EMBEDDING_MODEL: '' })).toMatchObject({ MIN_VECTOR_SIMILARITY: 0.45, EMBEDDING_MODEL: 'bge-m3' });
  });

  it('rejects the development JWT secret in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow('JWT_SECRET must be set in production');
  });

  it('reports invalid values', () => {
    expect(() => parseEnv({ LLM_REASONING_EFFORT: 'max' })).toThrow('LLM_REASONING_EFFORT');
  });
});
