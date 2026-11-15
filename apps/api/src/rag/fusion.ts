export interface FusedItem {
  id: string;
  score: number;
  /** Rank (from 1) in each input list, or null if the item is not there. */
  ranks: (number | null)[];
}

/**
 * Reciprocal Rank Fusion: score = Σ 1 / (k + rank).
 * Needs no comparable scales: Chroma cosine similarity and Postgres ts_rank
 * cannot be compared directly, but ranks can.
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
      if (item.ranks[li] !== null) return; // duplicate within one list: keep the best rank
      const rank = idx + 1;
      item.ranks[li] = rank;
      item.score += 1 / (k + rank);
    });
  });
  return [...byId.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
