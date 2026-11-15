import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { NetworkBlockedError } from './setup';

describe('offline test setup', () => {
  it('blocks fetch', async () => {
    await expect(fetch('http://localhost:11434/api/tags')).rejects.toBeInstanceOf(NetworkBlockedError);
  });

  it('blocks raw sockets (Postgres, Redis)', () => {
    expect(() => net.connect({ host: '127.0.0.1', port: 5432 })).toThrow(NetworkBlockedError);
  });
});
