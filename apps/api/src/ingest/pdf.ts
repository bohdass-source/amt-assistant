import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { PageText } from './chunker';

interface TextItem {
  str: string;
  transform: number[];
  width?: number;
}

interface PageProxy {
  pageIndex: number;
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{ items: TextItem[] }>;
}

const MAX_PDF_BYTES = 60 * 1024 * 1024;

/** Текст постранично: pdf-parse вызывает pagerender для каждой страницы по порядку. */
export async function extractPages(data: Buffer): Promise<PageText[]> {
  const pages: PageText[] = [];
  await pdfParse(data, {
    max: 0,
    pagerender: async (pageData: PageProxy) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      let text = '';
      let lastY: number | null = null;
      let lastXEnd: number | null = null;
      for (const item of content.items) {
        const x = item.transform[4];
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 1) {
          text += '\n';
          lastXEnd = null;
        } else if (lastXEnd !== null && x - lastXEnd > 1.5 && !text.endsWith(' ') && !item.str.startsWith(' ')) {
          text += ' ';
        }
        text += item.str;
        lastY = y;
        lastXEnd = x + (item.width ?? 0);
      }
      pages.push({ page: pageData.pageIndex + 1, text });
      return text;
    },
  });
  return pages.sort((a, b) => a.page - b.page);
}

export async function downloadPdf(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: { 'User-Agent': 'amt-assistant-ingest/0.1 (+https://github.com/)', Accept: 'application/pdf' },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_PDF_BYTES) throw new Error(`PDF too large: ${length} bytes`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) throw new Error(`PDF too large: ${buf.length} bytes`);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`Not a PDF (content-type ${res.headers.get('content-type')}) at ${url}`);
  }
  return buf;
}
