import type { MetadataCandidate, GameMetadataInput } from '../../shared';

/** Optional, user-initiated RAWG integration. API keys are never persisted. */
export interface MetadataProvider {
  search(term: string, apiKey: string): Promise<MetadataCandidate[]>;
  detail(id: number, apiKey: string): Promise<{ metadata: GameMetadataInput; imageUrl: string | null }>;
}
const BASE = 'https://api.rawg.io/api/games';
const TIMEOUT_MS = 12000;
function keyCheck(key: string): string {
  if (!/^[\w-]{8,160}$/.test(key)) throw new Error('A valid RAWG API key is required.');
  return key;
}
async function getJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Metadata provider returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length'));
  if (length > 2_000_000) throw new Error('Metadata response too large.');
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error('Metadata response too large.');
  return JSON.parse(body) as unknown;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, length = 500): string {
  return typeof value === 'string' ? value.slice(0, length).trim() : '';
}
function firstName(value: unknown): string {
  return Array.isArray(value) ? text(record(value[0]).name, 150) : '';
}
function sourceSlug(value: unknown): string | null {
  const slug = text(value, 150);
  return /^[a-z0-9-]+$/.test(slug) ? slug : null;
}
export const rawgProvider: MetadataProvider = {
  async search(term, apiKey) {
    if (!term.trim() || term.length > 120) throw new Error('Search must be 1–120 characters.');
    const url = new URL(BASE);
    url.searchParams.set('key', keyCheck(apiKey));
    url.searchParams.set('search', term.trim());
    url.searchParams.set('page_size', '10');
    const json = record(await getJson(url));
    const rows = Array.isArray(json.results) ? json.results : [];
    return rows.slice(0, 10).map(value => {
      const r = record(value);
      return { id: r.id, title: text(r.name, 150), released: text(r.released, 20), slug: sourceSlug(r.slug) };
    }).filter((row): row is MetadataCandidate => Number.isSafeInteger(row.id) && Number(row.id) > 0 && !!row.title);
  },
  async detail(id, apiKey) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid metadata game ID.');
    const url = new URL(`${BASE}/${id}`);
    url.searchParams.set('key', keyCheck(apiKey));
    const r = record(await getJson(url));
    const description = text(r.description_raw, 4000);
    const imageUrl = typeof r.background_image === 'string' ? r.background_image : null;
    return { metadata: {
      title: text(r.name, 200), description, released: text(r.released, 20),
      developer: firstName(r.developers), publisher: firstName(r.publishers), genre: firstName(r.genres),
      provider: 'rawg', providerId: String(id), providerSlug: sourceSlug(r.slug), artworkId: null
    }, imageUrl };
  }
};
