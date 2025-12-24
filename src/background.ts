// background.ts
// Canonical citation graph pipeline that merges evidence from OpenAlex and OpenCitations.

import type { ApiResponse } from './types';

type ProviderName = 'openalex' | 'opencitations';

interface CanonicalAuthor {
  canonicalId: string;
  displayName: string;
}

interface ExternalIds {
  doi?: string;
  openalexId?: string;
}

interface CanonicalWork {
  canonicalId: string;
  title: string;
  year?: number | null;
  authors: CanonicalAuthor[];
  externalIds: ExternalIds;
}

interface ProviderEdge {
  citing: CanonicalWork;
  cited: CanonicalWork;
  provenance: ProviderName;
}

interface CanonicalEdge {
  citingId: string;
  citedId: string;
  provenance: Set<ProviderName>;
}

const OPENALEX_API_BASE = 'https://api.openalex.org';
const OPEN_CITATIONS_BASE = 'https://opencitations.net/index/api/v1';
const WORKS_PER_PAGE = 200;
const POLITE_DELAY_MS = 50;
const TITLE_SIMILARITY_THRESHOLD = 0.88;

// Optional: increasing this can help when titles are common and the correct match
// isn't in the top few OpenAlex search results.
const MAX_TITLE_MATCHES = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeAuthorName(name: string): string {
  let cleaned = name.trim();

  // Remove academic prefixes early (important for "Dr Smith, Alex" style strings).
  const prefixPatterns = [/^professor\s*/i, /^prof\.?\s*/i, /^dr\.?\s*/i];
  for (const p of prefixPatterns) {
    cleaned = cleaned.replace(p, '');
  }

  // If name is in "Last, First Middle" format, reorder to "First Middle Last".
  const commaIndex = cleaned.indexOf(',');
  if (commaIndex !== -1) {
    const last = cleaned.slice(0, commaIndex).trim();
    const rest = cleaned.slice(commaIndex + 1).trim();
    if (rest) cleaned = `${rest} ${last}`.trim();
  }

  // Remove academic prefixes again in case they appear after reordering.
  for (const p of prefixPatterns) {
    cleaned = cleaned.replace(p, '');
  }

  cleaned = cleaned.replace(/\./g, '');
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ');
  return cleaned.trim();
}

function jaroWinkler(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  let m = 0;
  const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array<boolean>(s1.length);
  const s2Matches = new Array<boolean>(s2.length);
  for (let i = 0; i < s1.length; i++) {
    const low = Math.max(0, i - range);
    const high = Math.min(i + range + 1, s2.length);
    for (let j = low; j < high; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        m++;
        break;
      }
    }
  }
  if (m === 0) return 0;
  let k = 0;
  let t = 0;
  for (let i = 0; i < s1.length; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) t++;
      k++;
    }
  }
  const jaro = (m / s1.length + m / s2.length + (m - t / 2) / m) / 3;
  const p = 0.1;
  let l = 0;
  if (jaro > 0.7) {
    while (s1[l] === s2[l] && l < 4) l++;
    return jaro + l * p * (1 - jaro);
  }
  return jaro;
}

const normalizeText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\.,\/#!$%\^&\*;:{}=\_`~?"“”()\[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function normalizeDoi(doi: string | undefined | null): string | undefined {
  if (!doi) return undefined;
  return doi.trim().toLowerCase().replace(/^https?:\/\/doi.org\//, '');
}

function stripOpenAlexId(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return id.replace('https://openalex.org/', '').trim();
}

function canonicalWorkId(ids: ExternalIds): string | null {
  const doi = normalizeDoi(ids.doi);
  if (doi) return `doi:${doi}`;
  const openalexId = stripOpenAlexId(ids.openalexId);
  if (openalexId) return `openalex:${openalexId}`;
  return null;
}

function canonicalAuthorIdFromAuthorship(authorship: any): CanonicalAuthor | null {
  const orcid = authorship.author?.orcid as string | undefined;
  const openalexId = authorship.author?.id as string | undefined;
  const displayName = authorship.author?.display_name as string | undefined;

  if (orcid) {
    return {
      canonicalId: `orcid:${orcid.replace('https://orcid.org/', '')}`,
      displayName: displayName || orcid,
    };
  }
  if (openalexId) {
    return {
      canonicalId: `openalex:${stripOpenAlexId(openalexId)}`,
      displayName: displayName || openalexId,
    };
  }
  if (displayName) {
    return { canonicalId: `name:${normalizeText(displayName)}`, displayName };
  }
  return null;
}

function buildAuthorList(authorships: any[] | undefined): CanonicalAuthor[] {
  const authors: CanonicalAuthor[] = [];
  if (!authorships) return authors;
  for (const authorship of authorships) {
    const canonicalAuthor = canonicalAuthorIdFromAuthorship(authorship);
    if (canonicalAuthor) {
      authors.push(canonicalAuthor);
    }
  }
  return authors;
}

function canonicalizeOpenAlexWork(work: any): CanonicalWork | null {
  const externalIds: ExternalIds = {
    doi: normalizeDoi(work.doi),
    openalexId: stripOpenAlexId(work.id),
  };
  const id = canonicalWorkId(externalIds);
  if (!id) return null;
  return {
    canonicalId: id,
    title: work.display_name ?? '',
    year: work.publication_year ?? null,
    authors: buildAuthorList(work.authorships),
    externalIds,
  };
}

async function fetchOpenAlexWorkById(workId: string): Promise<CanonicalWork | null> {
  const normalizedId = workId.startsWith('https://') ? workId : `https://openalex.org/${workId}`;
  const resp = await fetch(`${OPENALEX_API_BASE}/works/${normalizedId}`);
  if (!resp.ok) return null;
  const data = await resp.json();
  return canonicalizeOpenAlexWork(data);
}

async function fetchOpenAlexWorkByDoi(doi: string): Promise<CanonicalWork | null> {
  const resp = await fetch(`${OPENALEX_API_BASE}/works/doi:${encodeURIComponent(doi)}`);
  if (!resp.ok) return null;
  const data = await resp.json();
  return canonicalizeOpenAlexWork(data);
}

/**
 * Initials-aware author name matching to handle cases like:
 *  - "Alex Jordan Smith" vs "AJ Smith"
 *  - "Alex Jordan Smith" vs "A Jordan Smith"
 *  - "Alex Jordan Smith" vs "Alex J Smith"
 */
const SURNAME_PARTICLES = new Set([
  'da',
  'de',
  'del',
  'della',
  'der',
  'di',
  'du',
  'la',
  'le',
  'van',
  'von',
  'st',
]);

function stripDiacritics(s: string): string {
  // Removes combining marks (Chrome safe)
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

type ParsedName = {
  surname: string; // normalized surname (may include particles)
  givenTokens: string[]; // normalized given tokens
  initials: string[]; // derived initials
};

function parseNameForMatch(name: string): ParsedName {
  // Reorder "Last, First Middle" -> "First Middle Last"
  let working = stripDiacritics(name).trim();
  const commaIndex = working.indexOf(',');
  if (commaIndex !== -1) {
    const left = working.slice(0, commaIndex).trim();
    const right = working.slice(commaIndex + 1).trim();
    if (right) working = `${right} ${left}`.trim();
  }

  const raw = working
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[.]/g, ' ')     // keep comma handled already
    .replace(/\s+/g, ' ')
    .trim();

  const partsRaw = raw.split(' ').filter(Boolean);
  const partsNorm = partsRaw.map((p) => normalizeText(p));

  if (partsNorm.length === 0) return { surname: '', givenTokens: [], initials: [] };

  // Surname = last token, plus any particles immediately preceding it (e.g., "van der Waals")
  let i = partsNorm.length - 1;
  const surnameTokens: string[] = [partsNorm[i]];
  i--;

  while (i >= 0 && SURNAME_PARTICLES.has(partsNorm[i])) {
    surnameTokens.unshift(partsNorm[i]);
    i--;
  }

  const givenNorm = partsNorm.slice(0, i + 1);
  const givenRaw = partsRaw.slice(0, i + 1);

  const initials: string[] = [];
  for (let idx = 0; idx < givenNorm.length; idx++) {
    const gn = givenNorm[idx];
    const gr = givenRaw[idx];

    if (!gn) continue;

    // Token is already an initial ("A")
    if (/^[a-z]$/.test(gn)) {
      initials.push(gn);
      continue;
    }

    // Detect compact ALLCAPS initials like "AJ", "AJP"
    const compact = gr.replace(/[^A-Za-z]/g, '');
    const isAllCaps = compact.length >= 2 && compact.length <= 4 && compact === compact.toUpperCase();
    const noVowels = !/[AEIOU]/.test(compact); // heuristic to avoid splitting "Al" into A,L

    if (isAllCaps && noVowels) {
      for (const ch of compact.toLowerCase()) initials.push(ch);
    } else {
      initials.push(gn[0]);
    }
  }

  return {
    surname: surnameTokens.join(' '),
    givenTokens: givenNorm,
    initials,
  };
}

function likelySameAuthorName(candidateDisplay: string, targetName: string): boolean {
  const c = parseNameForMatch(candidateDisplay);
  const t = parseNameForMatch(targetName);

  if (!c.surname || !t.surname) return false;

  // Strong surname match (required)
  const surnameOk = c.surname === t.surname || jaroWinkler(c.surname, t.surname) >= 0.95;
  if (!surnameOk) return false;

  // If both sides have at least one "real" given token, accept fuzzy given-name match
  const cGiven = c.givenTokens.filter((x) => x.length > 1);
  const tGiven = t.givenTokens.filter((x) => x.length > 1);

  if (cGiven.length && tGiven.length) {
    for (const cg of cGiven) {
      for (const tg of tGiven) {
        if (jaroWinkler(cg, tg) >= 0.9) return true;
      }
    }
  }

  // Otherwise fall back to initials logic
  if (!c.initials.length || !t.initials.length) return false;

  // First initial must match
  if (c.initials[0] !== t.initials[0]) return false;

  // If candidate provides multiple initials (AJ), require they match the target prefix (Alex Jordan)
  if (c.initials.length >= 2) {
    for (let i = 0; i < c.initials.length; i++) {
      if (t.initials[i] !== c.initials[i]) return false;
    }
  }

  return true;
}

async function resolveWorkByTitle(title: string, authorName: string): Promise<CanonicalWork | null> {
  const normalizedTitle = normalizeText(title);
  const url = `${OPENALEX_API_BASE}/works?search=${encodeURIComponent(
    title,
  )}&select=id,doi,display_name,publication_year,authorships&per-page=${MAX_TITLE_MATCHES}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const candidates: any[] = data.results || [];

  let best: CanonicalWork | null = null;
  let bestScore = 0;
  const sanitizedName = sanitizeAuthorName(authorName);

  for (const candidate of candidates) {
    const work = canonicalizeOpenAlexWork(candidate);
    if (!work) continue;
    const similarity = jaroWinkler(normalizedTitle, normalizeText(work.title));
    if (similarity < TITLE_SIMILARITY_THRESHOLD) continue;

    let score = similarity;

    // Updated: initials-aware matching to handle "AJ Smith" / "A Jordan Smith" cases.
    const authorHit = work.authors.some((a) => likelySameAuthorName(a.displayName, sanitizedName));
    if (authorHit) score += 0.05;

    if (score > bestScore) {
      bestScore = score;
      best = work;
    }
  }
  return best;
}

async function resolveWorksFromScholarTitles(authorName: string, titles: string[]): Promise<CanonicalWork[]> {
  const resolvedWorks: CanonicalWork[] = [];
  const seen = new Set<string>();
  for (const title of titles) {
    const work = await resolveWorkByTitle(title, authorName);
    if (work && !seen.has(work.canonicalId)) {
      resolvedWorks.push(work);
      seen.add(work.canonicalId);
    }
    await delay(POLITE_DELAY_MS);
  }
  return resolvedWorks;
}

async function fetchOpenAlexIncomingCitations(
  work: CanonicalWork,
  workRegistry: Map<string, CanonicalWork>,
): Promise<ProviderEdge[]> {
  const edges: ProviderEdge[] = [];
  const openAlexId = work.externalIds.openalexId;
  if (!openAlexId) return edges;

  let cursor: string | null = '*';
  while (cursor) {
    const url: string = `${OPENALEX_API_BASE}/works?filter=cites:${openAlexId}&select=id,doi,display_name,publication_year,authorships&per-page=${WORKS_PER_PAGE}&cursor=${cursor}`;
    const resp: Response = await fetch(url);
    if (!resp.ok) break;
    const data: any = await resp.json();
    const results: any[] = data.results || [];
    for (const result of results) {
      const citingWork = canonicalizeOpenAlexWork(result);
      if (!citingWork) continue;
      workRegistry.set(citingWork.canonicalId, citingWork);
      edges.push({ citing: citingWork, cited: work, provenance: 'openalex' });
    }
    cursor = data.meta?.next_cursor ?? null;
    if (cursor) {
      await delay(POLITE_DELAY_MS);
    }
  }

  return edges;
}

async function fetchOpenCitationsIncoming(
  work: CanonicalWork,
  workRegistry: Map<string, CanonicalWork>,
): Promise<ProviderEdge[]> {
  const edges: ProviderEdge[] = [];
  const doi = normalizeDoi(work.externalIds.doi);
  if (!doi) return edges;

  const resp = await fetch(`${OPEN_CITATIONS_BASE}/citations/doi/${encodeURIComponent(doi)}`);
  if (!resp.ok) return edges;
  const data = await resp.json();
  if (!Array.isArray(data)) return edges;

  for (const citation of data) {
    const citingDoi = normalizeDoi(citation.citing as string | undefined);
    if (!citingDoi) continue;
    const existing = workRegistry.get(`doi:${citingDoi}`);
    let citingWork: CanonicalWork | undefined = existing;
    if (!citingWork) {
      const fetched = await fetchOpenAlexWorkByDoi(citingDoi);
      if (fetched) {
        citingWork = fetched;
        workRegistry.set(citingWork.canonicalId, citingWork);
      }
    }
    if (!citingWork) continue;
    edges.push({ citing: citingWork, cited: work, provenance: 'opencitations' });
  }

  return edges;
}

async function fetchCitationEdges(
  work: CanonicalWork,
  workRegistry: Map<string, CanonicalWork>,
): Promise<ProviderEdge[]> {
  const [openAlexEdges, openCitationsEdges] = await Promise.all([
    fetchOpenAlexIncomingCitations(work, workRegistry),
    fetchOpenCitationsIncoming(work, workRegistry),
  ]);
  return [...openAlexEdges, ...openCitationsEdges];
}

function mergeEdges(edgeMap: Map<string, CanonicalEdge>, providerEdges: ProviderEdge[]): void {
  for (const edge of providerEdges) {
    const key = `${edge.citing.canonicalId}__${edge.cited.canonicalId}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.provenance.add(edge.provenance);
    } else {
      edgeMap.set(key, {
        citingId: edge.citing.canonicalId,
        citedId: edge.cited.canonicalId,
        provenance: new Set([edge.provenance]),
      });
    }
  }
}

function hasAuthorOverlap(citing: CanonicalWork, cited: CanonicalWork): boolean {
  if (!citing.authors.length || !cited.authors.length) return false;
  const citingAuthors = new Set(citing.authors.map((a) => a.canonicalId));
  return cited.authors.some((author) => citingAuthors.has(author.canonicalId));
}

function computeSelfCitationMetrics(
  edgeMap: Map<string, CanonicalEdge>,
  workRegistry: Map<string, CanonicalWork>,
): { total: number; self: number } {
  let total = 0;
  let self = 0;
  for (const edge of edgeMap.values()) {
    const citing = workRegistry.get(edge.citingId);
    const cited = workRegistry.get(edge.citedId);
    if (!citing || !cited) continue;
    total += 1;
    if (hasAuthorOverlap(citing, cited)) {
      self += 1;
    }
  }
  return { total, self };
}

async function processAuthor(authorName: string, publicationTitles: string[]): Promise<ApiResponse> {
  const sanitizedName = sanitizeAuthorName(authorName);
  const resolvedWorks = await resolveWorksFromScholarTitles(sanitizedName, publicationTitles);
  if (resolvedWorks.length === 0) {
    return { status: 'error', message: 'Could not resolve any works from Google Scholar titles.' };
  }

  const workRegistry = new Map<string, CanonicalWork>();
  resolvedWorks.forEach((work) => workRegistry.set(work.canonicalId, work));

  const edgeMap = new Map<string, CanonicalEdge>();
  for (const work of resolvedWorks) {
    const edges = await fetchCitationEdges(work, workRegistry);
    mergeEdges(edgeMap, edges);
  }

  const metrics = computeSelfCitationMetrics(edgeMap, workRegistry);
  const percentage = metrics.total > 0 ? (metrics.self / metrics.total) * 100 : 0;

  const coverageMessage = `Works resolved: ${resolvedWorks.length}. Unique citing→cited edges: ${metrics.total}. Evidence providers: OpenAlex + OpenCitations.`;

  return {
    status: 'success',
    selfCitations: metrics.self,
    totalCitations: metrics.total,
    percentage,
    message: coverageMessage,
  };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'processAuthor') {
    (async () => {
      try {
        const response = await processAuthor(request.authorName, request.publicationTitles);
        sendResponse(response);
      } catch (error) {
        const err = error as Error;
        sendResponse({ status: 'error', message: err.message || 'An unknown error occurred.' });
      }
    })();
    return true;
  }
  return false;
});
