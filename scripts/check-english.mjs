#!/usr/bin/env node
// Keeps code, comments and docs in English.
//
// The product answers in Russian and Ukrainian, so Cyrillic is expected in a few places:
// user-facing strings, the control questions and test fixtures. Those files are listed
// in CONTENT_FILES; comments inside them must still be English. Everywhere else any
// Cyrillic is an error, except inside Markdown code spans and code blocks (examples of
// real user input).
//
// Usage: node scripts/check-english.mjs   (exit code 1 on violations)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** Files whose strings are product content in Russian/Ukrainian. */
const CONTENT_FILES = [
  /^apps\/api\/src\/rag\/i18n\.ts$/, // refusal texts and the disclaimer
  /^apps\/api\/src\/rag\/prompts\.ts$/, // example of the expected answer style
  /^apps\/web\/lib\/i18n\.tsx$/, // UI strings
  /^apps\/web\/components\/Admin\.tsx$/, // admin UI, used by the project team in Russian
  /^apps\/web\/components\/Shell\.tsx$/, // bilingual label of the language switch
  /^apps\/web\/app\/(layout|admin\/page|sources\/page)\.tsx$/, // page titles and meta description
  /^data\/eval\/questions\.yaml$/, // control questions as users would type them
  /\.test\.ts$/, // test fixtures
];

/** Not checked yet; each entry must name the change that removes it. */
const PENDING = [
  /^README\.md$/, // rewritten in English in the README commit
];

const SKIP = [/^package-lock\.json$/, /\.(png|jpe?g|gif|ico|pdf|woff2?)$/];

const stripQuoted = (line) => line.replace(/`[^`]*`|"[^"]*"|'[^']*'|«[^»]*»/g, '');

/** Text after a comment marker, with quoted examples removed. */
function commentPart(line) {
  const code = stripQuoted(line);
  const m = /(?:^\s*(?:\/\/|\/\*+|\*|#)|\s(?:\/\/|\/\*+|#)\s)(.*)$/.exec(code);
  return m ? m[1] : '';
}

function markdownProse(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, (block) => block.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, '');
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const errors = [];

for (const file of files) {
  if ([...SKIP, ...PENDING].some((re) => re.test(file))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  if (!CYRILLIC.test(text)) continue;

  const isContent = CONTENT_FILES.some((re) => re.test(file));
  const lines = (file.endsWith('.md') ? markdownProse(text) : text).split('\n');
  lines.forEach((line, i) => {
    if (!CYRILLIC.test(line)) return;
    if (isContent && !CYRILLIC.test(commentPart(line))) return;
    errors.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}

if (errors.length) {
  console.error(`Non-English text found (${errors.length} lines):\n${errors.join('\n')}`);
  console.error('\nTranslate it, or add the file to CONTENT_FILES if the text is user-facing.');
  process.exit(1);
}
console.log(`check-english: ${files.length} tracked files OK`);
