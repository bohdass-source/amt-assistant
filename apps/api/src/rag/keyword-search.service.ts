import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface KeywordHit {
  id: string;
  rank: number;
}

/**
 * websearch_to_tsquery joins words with AND by default, which for a long question
 * almost always matches nothing. Terms are joined with OR instead and ranking is
 * left to ts_rank_cd. The websearch syntax never throws on arbitrary input, and the
 * query is passed as a bind parameter, so neither injection nor parser errors are possible.
 */
export function toOrQuery(query: string, maxTerms = 24): string {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(terms)].slice(0, maxTerms).join(' or ');
}

@Injectable()
export class KeywordSearchService {
  constructor(private readonly db: DbService) {}

  async search(query: string, k: number): Promise<KeywordHit[]> {
    const q = toOrQuery(query);
    if (!q) return [];
    return this.db.query<KeywordHit>(
      `SELECT c.id, ts_rank_cd(c.tsv, q, 32) AS rank
         FROM chunks c, websearch_to_tsquery('german', $1) q
        WHERE c.tsv @@ q
        ORDER BY rank DESC, c.id
        LIMIT $2`,
      [q, k],
    );
  }
}
