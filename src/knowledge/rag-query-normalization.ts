function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const QUERY_REPLACEMENTS: Array<[string, string]> = [
  ['autoposta', 'autopista'],
  ['autopostas', 'autopistas'],
  ['autovia', 'autovia'],
  ['autovias', 'autovias'],
  ['semi autopista', 'semiautopista'],
  ['semi autopistas', 'semiautopistas'],
  ['maxima', 'maxima'],
  ['minima', 'minima'],
];

export function normalizeRagQuery(query: string): string {
  let normalized = query.normalize('NFC');

  for (const [from, to] of QUERY_REPLACEMENTS) {
    const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi');
    normalized = normalized.replace(pattern, to);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}
