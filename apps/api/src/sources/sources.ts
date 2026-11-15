import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const isoDate = z.union([z.string(), z.date()]).transform((v, ctx) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected YYYY-MM-DD, got ${s}` });
    return z.NEVER;
  }
  return s;
});

export const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/, 'id: lowercase letters, digits and dashes'),
  title: z.string().min(3),
  publisher: z.string().min(2),
  type: z.enum(['merkblatt', 'fachliche-weisung', 'gesetz', 'verordnung', 'formular']),
  url: z.string().url().startsWith('https://'),
  page: z.string().url().optional(),
  date: isoDate,
  date_note: z.string().optional(),
  retrieved: isoDate,
});

export const sourcesFileSchema = z
  .object({
    topic: z.string(),
    documents: z.array(sourceSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const d of file.documents) {
      if (seen.has(d.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id ${d.id}` });
      seen.add(d.id);
    }
  });

export type Source = z.infer<typeof sourceSchema>;
export type SourcesFile = z.infer<typeof sourcesFileSchema>;

export function parseSources(yamlText: string): SourcesFile {
  return sourcesFileSchema.parse(parse(yamlText));
}

export function loadSources(path: string): SourcesFile {
  return parseSources(readFileSync(resolve(process.cwd(), path), 'utf8'));
}
