#!/usr/bin/env node
// Checks that relative links and images in tracked Markdown files point at files
// tracked by git, so the README never shows a broken screenshot or a dead link.
// External URLs are not fetched (CI must not depend on other sites being up).
//
// Usage: node scripts/check-links.mjs   (exit code 1 on broken links)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean));
const trackedDirs = new Set([...tracked].flatMap((f) => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
const markdown = [...tracked].filter((f) => f.endsWith('.md'));

// [text](target "title"), ![alt](target), <img src="target">, and [ref]: target definitions.
const PATTERNS = [/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, /<img[^>]+src="([^"]+)"/g, /^\s*\[[^\]]+\]:\s*(\S+)/gm];

const errors = [];
for (const file of markdown) {
  // Code blocks contain example commands and JSON, not links.
  const text = readFileSync(file, 'utf8').replace(/^(```|~~~)[\s\S]*?^\1/gm, (b) => b.replace(/[^\n]/g, ' '));
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = normalize(join(dirname(file), decodeURIComponent(target.split('#')[0].split('?')[0]))).replace(/\/$/, '');
      if (path.startsWith('..')) {
        errors.push(`${file}: ${target} points outside the repository`);
      } else if (!tracked.has(path) && !trackedDirs.has(path)) {
        const line = text.slice(0, m.index).split('\n').length;
        errors.push(`${file}:${line}: ${target} → ${path} is not a tracked file`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Broken links (${errors.length}):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`check-links: ${markdown.length} Markdown files OK`);
