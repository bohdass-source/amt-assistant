export interface FusedItem {
  id: string;
  score: number;
  /** Ранг (с 1) в каждом исходном списке или null, если элемента там нет. */
  ranks: (number | null)[];
}

/**
 * Reciprocal Rank Fusion: score = Σ 1 / (k + rank).
 * Не требует сопоставимых шкал — косинусное сходство Chroma и ts_rank Postgres
 * несравнимы напрямую, а ранги сравнимы.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): FusedItem[] {
  const byId = new Map<string, FusedItem>();
  lists.forEach((list, li) => {
    list.forEach((id, idx) => {
      let item = byId.get(id);
      if (!item) {
        item = { id, score: 0, ranks: lists.map(() => null) };
        byId.set(id, item);
      }
      if (item.ranks[li] !== null) return; // дубликат в одном списке — берём лучший ранг
      const rank = idx + 1;
      item.ranks[li] = rank;
      item.score += 1 / (k + rank);
    });
  });
  return [...byId.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
