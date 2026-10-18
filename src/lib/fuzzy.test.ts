import { describe, expect, test } from 'bun:test';
import { fuzzyMatch, rankByFuzzy } from './fuzzy';

describe('fuzzyMatch', () => {
  test('an empty query matches everything', () => {
    expect(fuzzyMatch('  ', 'Jellyfin')).toEqual({ score: 0, indices: [] });
  });

  test('contiguous matches score best at the start, then at a word start', () => {
    const start = fuzzyMatch('home', 'Home Assistant')!;
    const word = fuzzyMatch('assist', 'Home Assistant')!;
    const inside = fuzzyMatch('sist', 'Home Assistant')!;
    expect(start.indices).toEqual([0, 1, 2, 3]);
    expect(start.score).toBeGreaterThan(fuzzyMatch('ome', 'Home Assistant')!.score);
    expect(word.score).toBeGreaterThan(inside.score);
    expect(inside.score).toBeGreaterThanOrEqual(100);
  });

  test('matches characters in order across gaps, ignoring query spaces', () => {
    const match = fuzzyMatch('home asst', 'Home Assistant')!;
    expect(match).not.toBeNull();
    expect(match.indices[0]).toBe(0);
    expect(fuzzyMatch('jlf', 'Jellyfin')!.indices).toEqual([0, 2, 5]);
  });

  test('prefers word starts and consecutive characters', () => {
    // Both are in-order matches; only one lands on word starts
    expect(fuzzyMatch('ha', 'home-assistant')!.score).toBeGreaterThan(fuzzyMatch('ha', 'hydra')!.score);
    expect(fuzzyMatch('gf', 'grafana-frontend')!.score).toBeGreaterThan(fuzzyMatch('gf', 'giraffe')!.score);
  });

  test('characters out of order or missing do not match', () => {
    expect(fuzzyMatch('nfj', 'Jellyfin')).toBeNull();
    expect(fuzzyMatch('plexx', 'Plex')).toBeNull();
  });

  test('special characters are plain text', () => {
    expect(fuzzyMatch('c++', 'Notes (c++)')!.indices).toEqual([7, 8, 9]);
    expect(fuzzyMatch('[a-z', 'range [a-z]')).not.toBeNull();
  });
});

describe('rankByFuzzy', () => {
  const items = [
    { name: 'Grafana', host: 'metrics.example.com' },
    { name: 'Metrics exporter', host: 'exporter.example.com' },
    { name: 'Mealie', host: 'recipes.example.com' },
  ];
  const fields = [
    { get: (i: (typeof items)[number]) => i.name, weight: 4 },
    { get: (i: (typeof items)[number]) => i.host, weight: 2 },
  ];

  test('weights fields and keeps only matches', () => {
    const ranked = rankByFuzzy('metrics', items, fields);
    // A name match outranks the same text in a host
    expect(ranked.map((r) => r.item.name)).toEqual(['Metrics exporter', 'Grafana']);
    expect(ranked[0].highlight).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Grafana matched on its host only, so nothing in its name is highlighted
    expect(ranked[1].highlight).toEqual([]);
  });

  test('matches in other fields break ties between equal best matches', () => {
    const commands = [
      { name: 'Scan cluster routes', host: 'discover httproute' },
      { name: 'Open cluster telemetry', host: 'cluster nodes pods' },
    ];
    expect(rankByFuzzy('cluster', commands, fields)[0].item.name).toBe('Open cluster telemetry');
  });

  test('an empty query keeps every item in order', () => {
    expect(rankByFuzzy('', items, fields).map((r) => r.item.name)).toEqual(['Grafana', 'Metrics exporter', 'Mealie']);
  });

  test('equal scores keep the input order', () => {
    const twins = [{ name: 'Alpha', host: 'a' }, { name: 'Alpha', host: 'b' }];
    expect(rankByFuzzy('alpha', twins, fields).map((r) => r.item.host)).toEqual(['a', 'b']);
  });
});
