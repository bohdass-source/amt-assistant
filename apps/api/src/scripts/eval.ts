/**
 * Прогон контрольных вопросов против работающего API.
 *
 *   npm run eval -- --mode=search            # только поиск: верный документ в top-k
 *   npm run eval -- --mode=answer            # полный ответ: верный документ среди сносок
 *   npm run eval -- --api=https://amt.example.org --k=3 --out=../../reports/eval.json
 *
 * Код выхода 1, если верных источников меньше --min (по умолчанию 16)
 * или хотя бы один вопрос вне корпуса не получил отказ.
 */
import '../load-env';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

interface EvalFile {
  answerable: { id: string; lang: string; question: string; expected_documents: string[] }[];
  out_of_corpus: { id: string; lang: string; question: string }[];
}

interface Outcome {
  id: string;
  kind: 'answerable' | 'out_of_corpus';
  question: string;
  pass: boolean;
  refused: boolean;
  refusalReason: string | null;
  foundDocuments: string[];
  expected?: string[];
  queryDe?: string;
  ms: number;
  error?: string;
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const API = (args.api ?? process.env.EVAL_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const MODE = args.mode === 'answer' ? 'answer' : 'search';
const K = Number(args.k ?? 3);
const MIN = Number(args.min ?? 16);
const FILE = resolve(process.cwd(), args.file ?? '../../data/eval/questions.yaml');

async function search(question: string) {
  const res = await fetch(`${API}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.SEARCH_API_KEY ? { 'x-api-key': process.env.SEARCH_API_KEY } : {}) },
    body: JSON.stringify({ query: question, k: K }),
  });
  if (!res.ok) throw new Error(`search HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    refused: boolean;
    refusal_reason: string | null;
    query_de: string;
    results: { document_id: string }[];
  };
  return {
    refused: body.refused,
    refusalReason: body.refusal_reason,
    queryDe: body.query_de,
    documents: [...new Set(body.results.slice(0, K).map((r) => r.document_id))],
  };
}

let token: string | undefined;
async function answer(question: string) {
  if (!token) {
    const res = await fetch(`${API}/api/auth/guest`, { method: 'POST' });
    if (!res.ok) throw new Error(`guest HTTP ${res.status}`);
    token = ((await res.json()) as { token: string }).token;
  }
  const res = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: question }),
  });
  if (!res.ok || !res.body) throw new Error(`chat HTTP ${res.status}`);
  const text = await res.text();
  let done: { refused: boolean; refusalReason: string | null; citations: { documentId: string }[] } | undefined;
  let queryDe: string | undefined;
  for (const block of text.split('\n\n')) {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (!event || !data) continue;
    if (event === 'error') throw new Error(`chat error: ${data}`);
    if (event === 'meta') queryDe = JSON.parse(data).queryDe;
    if (event === 'done') done = JSON.parse(data);
  }
  if (!done) throw new Error('chat stream ended without done event');
  return {
    refused: done.refused,
    refusalReason: done.refusalReason,
    queryDe,
    documents: [...new Set(done.citations.map((c) => c.documentId))],
  };
}

async function main() {
  const evalSet = parse(readFileSync(FILE, 'utf8')) as EvalFile;
  const run = MODE === 'answer' ? answer : search;
  const outcomes: Outcome[] = [];

  console.log(`amt-assistant eval · mode=${MODE} · k=${K} · api=${API}\n`);

  for (const q of evalSet.answerable) {
    const t = Date.now();
    try {
      const r = await run(q.question);
      const pass = !r.refused && r.documents.some((d) => q.expected_documents.includes(d));
      outcomes.push({ id: q.id, kind: 'answerable', question: q.question, pass, refused: r.refused, refusalReason: r.refusalReason, foundDocuments: r.documents, expected: q.expected_documents, queryDe: r.queryDe, ms: Date.now() - t });
    } catch (err) {
      outcomes.push({ id: q.id, kind: 'answerable', question: q.question, pass: false, refused: false, refusalReason: null, foundDocuments: [], expected: q.expected_documents, ms: Date.now() - t, error: (err as Error).message });
    }
    const o = outcomes.at(-1)!;
    console.log(`${o.pass ? '✓' : '✗'} ${o.id.padEnd(30)} ${o.error ?? (o.refused ? `REFUSED (${o.refusalReason})` : o.foundDocuments.join(', '))}`);
  }
  console.log('');
  for (const q of evalSet.out_of_corpus) {
    const t = Date.now();
    try {
      const r = await run(q.question);
      outcomes.push({ id: q.id, kind: 'out_of_corpus', question: q.question, pass: r.refused, refused: r.refused, refusalReason: r.refusalReason, foundDocuments: r.documents, queryDe: r.queryDe, ms: Date.now() - t });
    } catch (err) {
      outcomes.push({ id: q.id, kind: 'out_of_corpus', question: q.question, pass: false, refused: false, refusalReason: null, foundDocuments: [], ms: Date.now() - t, error: (err as Error).message });
    }
    const o = outcomes.at(-1)!;
    console.log(`${o.pass ? '✓' : '✗'} ${o.id.padEnd(30)} ${o.error ?? (o.refused ? `refused (${o.refusalReason})` : `ANSWERED from ${o.foundDocuments.join(', ')}`)}`);
  }

  const answerable = outcomes.filter((o) => o.kind === 'answerable');
  const ooc = outcomes.filter((o) => o.kind === 'out_of_corpus');
  const hits = answerable.filter((o) => o.pass).length;
  const refusals = ooc.filter((o) => o.pass).length;
  const ok = hits >= MIN && refusals === ooc.length;

  console.log(`\nВерный источник: ${hits}/${answerable.length} (нужно ≥ ${MIN})`);
  console.log(`Отказ вне корпуса: ${refusals}/${ooc.length} (нужно все)`);
  console.log(ok ? 'PASS' : 'FAIL');

  if (args.out) {
    const out = resolve(process.cwd(), args.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ mode: MODE, k: K, api: API, at: new Date().toISOString(), hits, refusals, ok, outcomes }, null, 2));
    console.log(`Report: ${out}`);
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
