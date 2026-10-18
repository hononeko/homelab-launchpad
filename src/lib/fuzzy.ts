export interface FuzzyMatch {
  score: number;
  // Positions in the text that matched, for highlighting
  indices: number[];
}

const WORD_SEPARATORS = new Set([' ', '-', '_', '.', '/', ':', '&']);

function isWordStart(text: string, index: number): boolean {
  return index === 0 || WORD_SEPARATORS.has(text[index - 1]);
}

/**
 * Scores how well `query` matches `text`, or null when it doesn't. A
 * contiguous match scores highest (more at the start or a word start);
 * otherwise every query character must appear in order, with bonuses for
 * consecutive characters and word starts. Spaces in the query are ignored
 * for the in-order match, so "home asst" still finds "Home Assistant".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  const at = t.indexOf(q);
  if (at >= 0) {
    let score = 100 + q.length * 2;
    if (at === 0) score += 40;
    else if (isWordStart(t, at)) score += 20;
    return { score, indices: Array.from({ length: q.length }, (_, i) => at + i) };
  }

  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of q.replaceAll(' ', '')) {
    const index = t.indexOf(char, from);
    if (index < 0) return null;
    const previous = indices.at(-1);
    score += 1;
    if (previous !== undefined && index === previous + 1) score += 5;
    if (isWordStart(t, index)) score += 4;
    // Long gaps make a match less convincing
    if (previous !== undefined) score -= Math.min(index - previous - 1, 10) * 0.2;
    indices.push(index);
    from = index + 1;
  }
  return { score, indices };
}

export interface RankedField<T> {
  get: (item: T) => string;
  weight: number;
}

export interface RankedItem<T> {
  item: T;
  score: number;
  // Matched positions in the first field, when that field matched
  highlight: number[];
}

// Share of the other matching fields' scores added to the best one
const SECONDARY_FIELD_WEIGHT = 0.25;

/**
 * Items that match the query in any field, best first (ties keep their input
 * order). The best field decides; other matching fields add a smaller bonus,
 * so "cluster" ranks a command tagged "cluster" above one that only says it.
 */
export function rankByFuzzy<T>(query: string, items: T[], fields: RankedField<T>[]): RankedItem<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, score: 0, highlight: [] }));
  const ranked: RankedItem<T>[] = [];
  for (const item of items) {
    const scores: number[] = [];
    let highlight: number[] = [];
    fields.forEach((field, index) => {
      const match = fuzzyMatch(query, field.get(item));
      if (!match) return;
      if (index === 0) highlight = match.indices;
      scores.push(match.score * field.weight);
    });
    if (scores.length === 0) continue;
    const best = Math.max(...scores);
    const total = scores.reduce((sum, score) => sum + score, 0);
    ranked.push({ item, score: best + (total - best) * SECONDARY_FIELD_WEIGHT, highlight });
  }
  // Array.prototype.sort is stable, so equal scores keep the caller's order
  return ranked.sort((a, b) => b.score - a.score);
}
