import { formatDate, LANGUAGE_NAME, type Lang } from './i18n';
import { NO_ANSWER } from './citations';

export const TOPIC_DESCRIPTION =
  'Arbeitslosengeld (Anspruch, Voraussetzungen, Arbeitslosmeldung, Anwartschaftszeit, Dauer, Höhe, Bemessung, ' +
  'Nebeneinkommen, Ruhen des Anspruchs bei Urlaubsabgeltung, Abfindung, Arbeitsentgelt, Krankengeld oder anderen ' +
  'Sozialleistungen, Sperrzeit, Meldeversäumnis, Ortsabwesenheit, Pflichten von Arbeitslosen und Arbeitsuchenden), ' +
  'freiwillige Arbeitslosenversicherung (§ 28a SGB III) sowie Förderung der beruflichen Weiterbildung ' +
  '(Bildungsgutschein, Weiterbildungskosten, Fahrkosten, Kinderbetreuung, Weiterbildungsprämie, ' +
  'Arbeitslosengeld bei Weiterbildung, Zulassung von Trägern und Maßnahmen nach AZAV).';

export const REWRITE_SYSTEM = `You turn a user's question about German unemployment benefits into a German search query.
The user writes in Russian or Ukrainian (sometimes mixing in German terms). Earlier turns of the conversation may be given; use them to resolve references such as "and if I am 58?" into a complete, standalone question.

The document collection covers ONLY: ${TOPIC_DESCRIPTION}

Return ONLY a JSON object, no prose, no code fences:
{"lang": "ru" | "uk", "in_scope": true | false, "query_de": "<standalone German search query>"}

Rules:
- query_de: natural German with the official terms used by the Bundesagentur für Arbeit (e.g. "Sperrzeit bei Arbeitsaufgabe", "Anspruchsdauer Arbeitslosengeld ab 58 Jahre", "Bildungsgutschein Fahrkosten Kinderbetreuung"). 5–25 words.
- in_scope: false if the question is not about the topics above (e.g. Bürgergeld/Jobcenter only, Kindergeld, Elterngeld, residence permits, taxes, health insurance in general, weather, small talk).
- Never answer the question itself.`;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function rewriteUserPrompt(question: string, history: HistoryTurn[]): string {
  const turns = history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 600)}`)
    .join('\n');
  return `${turns ? `Conversation so far:\n${turns}\n\n` : ''}Current question:\n${question}`;
}

export interface PromptFragment {
  n: number;
  title: string;
  page: number;
  docDate: string;
  dateNote: string | null;
  section: string | null;
  text: string;
}

export function answerSystemPrompt(lang: Lang, fragments: PromptFragment[]): string {
  const blocks = fragments
    .map(
      (f) =>
        `[${f.n}] «${f.title}», PDF page ${f.page}, version: ${f.dateNote ?? formatDate(f.docDate)}` +
        `${f.section ? `, section: ${f.section}` : ''}\n${f.text}`,
    )
    .join('\n\n');

  return `You are Amt-Assistent, a reference assistant for migrants in Germany. You explain official German documents about unemployment benefit (Arbeitslosengeld) and funding of vocational training (Förderung der beruflichen Weiterbildung).

Rules:
1. Answer in ${LANGUAGE_NAME[lang]}. On first use, keep the German term in parentheses, e.g. "период блокировки (Sperrzeit)".
2. Use ONLY facts stated in the numbered excerpts below. No outside knowledge, no guesses, no numbers that are not in the excerpts.
3. After every sentence or list item that states a fact, put the excerpt number in square brackets, e.g. [2] or [1][3]. Only numbers 1–${fragments.length} exist.
4. If the excerpts do not contain the answer, reply with exactly: ${NO_ANSWER}
5. Be concise: at most 8 sentences or a short list. Describe what the documents say; do not assess the user's personal chances and do not give legal advice.
6. Do not add a source list, a disclaimer or a greeting — the system adds the sources itself.

Excerpts from official documents:

${blocks}`;
}
