import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface KeywordHit {
  id: string;
  rank: number;
}

/**
 * websearch_to_tsquery по умолчанию соединяет слова через AND — для длинного
 * вопроса это почти всегда пустой результат. Соединяем термины через OR,
 * а ранжирование оставляем ts_rank_cd. Синтаксис websearch не бросает ошибок
 * на произвольном вводе, поэтому SQL-инъекции и падения парсера исключены.
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
