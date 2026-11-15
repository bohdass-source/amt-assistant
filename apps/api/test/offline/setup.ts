// Offline tests must never reach a real model, database or vector store.
// Any network call fails loudly, so a missing fake cannot silently turn a test
// into a live check (and a flaky one).
import net from 'node:net';

export class NetworkBlockedError extends Error {}

const block = (what: string): never => {
  throw new NetworkBlockedError(`Offline test tried to use the network (${what}). Pass a fake instead.`);
};

globalThis.fetch = (async (input: unknown) => block(`fetch ${String(input)}`)) as typeof fetch;

net.Socket.prototype.connect = function connect(...args: unknown[]) {
  return block(`socket ${JSON.stringify(args[0])}`);
} as typeof net.Socket.prototype.connect;
