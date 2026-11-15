/**
 * LIVE CHECK: runs the control questions against a running API backed by a real
 * model and a real index. Not a test: results depend on the model, the corpus and
 * the hardware, and it is never run in CI. Offline tests are in test/offline.
 *
 *   npm run live:search                   # retrieval only: expected document in top-k
 *   npm run live:answer                   # full answer: expected document among the footnotes
 *   npm run live:search -- --api=https://amt.example.org --k=5
 *
 * Writes reports/live/<mode>.json and reports/live/<mode>.md with the models, the
 * index size and the git commit it ran against.
 *
 * Exit codes: 0 pass, 1 fail (fewer than --min expected sources, default 16, or an
 * out-of-corpus question answered), 2 no live system to check (API down or empty index).
 */
import '../load-env';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

interface QuestionsFile {
  answerable: { id: string; lang: string; question: string; expected_documents: string[] }[];
  out_of_corpus: { id: string; lang: string; question: string }[];
}

interface Health {
  index: { documents: number; chunks: number };
  models: { embedding: string; answer: string; rewrite: string };
  minVectorSimilarity: number;
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

const REPO_ROOT = resolve(__dirname, '../../../..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const API = (args.api ?? process.env.LIVE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const MODE = args.mode === 'answer' ? 'answer' : 'search';
const K = Number(args.k ?? 3);
const MIN = Number(args.min ?? 16);
const QUESTIONS = resolve(REPO_ROOT, args.file ?? 'data/eval/questions.yaml');
const OUT_DIR = resolve(REPO_ROOT, args.out ?? 'reports/live');

class NoLiveSystem extends Error {}

async function preflight(): Promise<Health> {
  let res: Response;
  try {
    res = await fetch(`${API}/api/health`);
  } catch (err) {
    throw new NoLiveSystem(`API not reachable at ${API} (${(err as Error).message}). Start it first, see README.`);
  }
  if (!res.ok) throw new NoLiveSystem(`API health is ${res.status}: ${await res.text()}`);
  const health = (await res.json()) as Partial<Health>;
  if (!health.index || !health.models) throw new NoLiveSystem('API health has no index/models info; is it an older build?');
  if (health.index.chunks === 0) throw new NoLiveSystem('The index is empty. Ingest the corpus from the admin page first.');
  return health as Health;
}

function gitCommit(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return null;
  }
}

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

function markdown(report: {
  mode: string;
  startedAt: string;
  gitCommit: string | null;
  models: Health['models'];
  index: Health['index'];
  settings: Record<string, number>;
  summary: { expectedSource: string; outOfCorpusRefused: string; pass: boolean; medianMs: number };
  outcomes: Outcome[];
}): string {
  const row = (o: Outcome) => {
    const found = o.error ? `error: ${o.error}` : o.refused ? `refused (${o.refusalReason})` : o.foundDocuments.join(', ');
    return `| ${o.pass ? 'pass' : '**FAIL**'} | ${o.id} | ${found} | ${o.expected?.join(', ') ?? 'refusal'} | ${o.ms} |`;
  };
  const what = report.mode === 'answer' ? 'documents cited in the answer' : `documents in the search top-${report.settings.k}`;
  return [
    `# Live check: ${report.mode}`,
    '',
    'Generated by `src/live/live-check.ts` against a running system with a real model. Not a unit test.',
    '',
    `- Run: ${report.startedAt}, commit \`${report.gitCommit ?? 'unknown'}\``,
    `- Models: embeddings \`${report.models.embedding}\`, query rewrite \`${report.models.rewrite}\`, answers \`${report.models.answer}\``,
    `- Index: ${report.index.documents} documents, ${report.index.chunks} chunks`,
    `- Settings: ${Object.entries(report.settings).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    '',
    `**Expected source found: ${report.summary.expectedSource}** (need at least ${report.settings.min})  `,
    `**Out-of-corpus questions refused: ${report.summary.outOfCorpusRefused}** (need all)  `,
    `**Result: ${report.summary.pass ? 'PASS' : 'FAIL'}**, median ${report.summary.medianMs} ms per question`,
    '',
    `| result | question | ${what} | expected | ms |`,
    '|---|---|---|---|---|',
    ...report.outcomes.map(row),
    '',
  ].join('\n');
}

async function main() {
  const health = await preflight();
  const questions = parse(readFileSync(QUESTIONS, 'utf8')) as QuestionsFile;
  const run = MODE === 'answer' ? answer : search;
  const outcomes: Outcome[] = [];
  const startedAt = new Date().toISOString();

  console.log(`LIVE CHECK · mode=${MODE} · k=${K} · api=${API}`);
  console.log(`models: rewrite=${health.models.rewrite} answer=${health.models.answer} embedding=${health.models.embedding}`);
  console.log(`index: ${health.index.documents} documents, ${health.index.chunks} chunks\n`);

  const ask = async (id: string, kind: Outcome['kind'], question: string, expected?: string[]) => {
    const t = Date.now();
    try {
      const r = await run(question);
      const pass = kind === 'out_of_corpus' ? r.refused : !r.refused && r.documents.some((d) => expected!.includes(d));
      outcomes.push({ id, kind, question, pass, refused: r.refused, refusalReason: r.refusalReason, foundDocuments: r.documents, expected, queryDe: r.queryDe, ms: Date.now() - t });
    } catch (err) {
      outcomes.push({ id, kind, question, pass: false, refused: false, refusalReason: null, foundDocuments: [], expected, ms: Date.now() - t, error: (err as Error).message });
    }
    const o = outcomes.at(-1)!;
    const found = o.error ?? (o.refused ? `refused (${o.refusalReason})` : o.foundDocuments.join(', '));
    console.log(`${o.pass ? '✓' : '✗'} ${o.id.padEnd(30)} ${found}`);
  };

  for (const q of questions.answerable) await ask(q.id, 'answerable', q.question, q.expected_documents);
  console.log('');
  for (const q of questions.out_of_corpus) await ask(q.id, 'out_of_corpus', q.question);

  const answerable = outcomes.filter((o) => o.kind === 'answerable');
  const ooc = outcomes.filter((o) => o.kind === 'out_of_corpus');
  const hits = answerable.filter((o) => o.pass).length;
  const refusals = ooc.filter((o) => o.pass).length;
  const pass = hits >= MIN && refusals === ooc.length;
  const times = outcomes.map((o) => o.ms).sort((a, b) => a - b);

  const report = {
    check: 'live',
    mode: MODE,
    startedAt,
    finishedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    api: API,
    models: health.models,
    index: health.index,
    settings: { k: K, min: MIN, minVectorSimilarity: health.minVectorSimilarity },
    summary: {
      expectedSource: `${hits}/${answerable.length}`,
      outOfCorpusRefused: `${refusals}/${ooc.length}`,
      pass,
      medianMs: times[Math.floor(times.length / 2)] ?? 0,
    },
    outcomes,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, `${MODE}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(OUT_DIR, `${MODE}.md`), markdown(report));

  console.log(`\nExpected source: ${hits}/${answerable.length} (need ≥ ${MIN})`);
  console.log(`Out-of-corpus refused: ${refusals}/${ooc.length} (need all)`);
  console.log(pass ? 'PASS' : 'FAIL');
  console.log(`Report: ${resolve(OUT_DIR, `${MODE}.md`)}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof NoLiveSystem ? `LIVE CHECK not run: ${err.message}` : err);
  process.exit(2);
});
