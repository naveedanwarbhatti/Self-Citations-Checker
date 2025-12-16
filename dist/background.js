// background.ts
// Canonical citation graph pipeline that merges evidence from OpenAlex and OpenCitations.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const OPENALEX_API_BASE = 'https://api.openalex.org';
const OPEN_CITATIONS_BASE = 'https://opencitations.net/index/api/v1';
const WORKS_PER_PAGE = 200;
const POLITE_DELAY_MS = 50;
const TITLE_SIMILARITY_THRESHOLD = 0.88;
const MAX_TITLE_MATCHES = 5;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function sanitizeAuthorName(name) {
    let cleaned = name.trim();
    const commaIndex = cleaned.indexOf(',');
    if (commaIndex !== -1) {
        cleaned = cleaned.substring(0, commaIndex);
    }
    const prefixPatterns = [
        /^professor\s*/i,
        /^prof\.?\s*/i,
        /^dr\.?\s*/i,
    ];
    for (const p of prefixPatterns) {
        cleaned = cleaned.replace(p, '');
    }
    cleaned = cleaned.replace(/\./g, '');
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ');
    return cleaned.trim();
}
function jaroWinkler(s1, s2) {
    if (!s1 || !s2)
        return 0;
    if (s1 === s2)
        return 1;
    let m = 0;
    const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length);
    const s2Matches = new Array(s2.length);
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
    if (m === 0)
        return 0;
    let k = 0;
    let t = 0;
    for (let i = 0; i < s1.length; i++) {
        if (s1Matches[i]) {
            while (!s2Matches[k])
                k++;
            if (s1[i] !== s2[k])
                t++;
            k++;
        }
    }
    const jaro = (m / s1.length + m / s2.length + (m - t / 2) / m) / 3;
    const p = 0.1;
    let l = 0;
    if (jaro > 0.7) {
        while (s1[l] === s2[l] && l < 4)
            l++;
        return jaro + l * p * (1 - jaro);
    }
    return jaro;
}
const normalizeText = (s) => s.toLowerCase().replace(/[\.,\/#!$%\^&\*;:{}=\_`~?"“”()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
function normalizeDoi(doi) {
    if (!doi)
        return undefined;
    return doi.trim().toLowerCase().replace(/^https?:\/\/doi.org\//, '');
}
function stripOpenAlexId(id) {
    if (!id)
        return undefined;
    return id.replace('https://openalex.org/', '').trim();
}
function canonicalWorkId(ids) {
    const doi = normalizeDoi(ids.doi);
    if (doi)
        return `doi:${doi}`;
    const openalexId = stripOpenAlexId(ids.openalexId);
    if (openalexId)
        return `openalex:${openalexId}`;
    return null;
}
function canonicalAuthorIdFromAuthorship(authorship) {
    var _a, _b, _c;
    const orcid = (_a = authorship.author) === null || _a === void 0 ? void 0 : _a.orcid;
    const openalexId = (_b = authorship.author) === null || _b === void 0 ? void 0 : _b.id;
    const displayName = (_c = authorship.author) === null || _c === void 0 ? void 0 : _c.display_name;
    if (orcid) {
        return { canonicalId: `orcid:${orcid.replace('https://orcid.org/', '')}`, displayName: displayName || orcid };
    }
    if (openalexId) {
        return { canonicalId: `openalex:${stripOpenAlexId(openalexId)}`, displayName: displayName || openalexId };
    }
    if (displayName) {
        return { canonicalId: `name:${normalizeText(displayName)}`, displayName };
    }
    return null;
}
function buildAuthorList(authorships) {
    const authors = [];
    if (!authorships)
        return authors;
    for (const authorship of authorships) {
        const canonicalAuthor = canonicalAuthorIdFromAuthorship(authorship);
        if (canonicalAuthor) {
            authors.push(canonicalAuthor);
        }
    }
    return authors;
}
function canonicalizeOpenAlexWork(work) {
    var _a, _b;
    const externalIds = {
        doi: normalizeDoi(work.doi),
        openalexId: stripOpenAlexId(work.id),
    };
    const id = canonicalWorkId(externalIds);
    if (!id)
        return null;
    return {
        canonicalId: id,
        title: (_a = work.display_name) !== null && _a !== void 0 ? _a : '',
        year: (_b = work.publication_year) !== null && _b !== void 0 ? _b : null,
        authors: buildAuthorList(work.authorships),
        externalIds,
    };
}
function fetchOpenAlexWorkById(workId) {
    return __awaiter(this, void 0, void 0, function* () {
        const normalizedId = workId.startsWith('https://') ? workId : `https://openalex.org/${workId}`;
        const resp = yield fetch(`${OPENALEX_API_BASE}/works/${normalizedId}`);
        if (!resp.ok)
            return null;
        const data = yield resp.json();
        return canonicalizeOpenAlexWork(data);
    });
}
function fetchOpenAlexWorkByDoi(doi) {
    return __awaiter(this, void 0, void 0, function* () {
        const resp = yield fetch(`${OPENALEX_API_BASE}/works/doi:${encodeURIComponent(doi)}`);
        if (!resp.ok)
            return null;
        const data = yield resp.json();
        return canonicalizeOpenAlexWork(data);
    });
}
function resolveWorkByTitle(title, authorName) {
    return __awaiter(this, void 0, void 0, function* () {
        const normalizedTitle = normalizeText(title);
        const url = `${OPENALEX_API_BASE}/works?search=${encodeURIComponent(title)}&select=id,doi,display_name,publication_year,authorships&per-page=${MAX_TITLE_MATCHES}`;
        const resp = yield fetch(url);
        if (!resp.ok)
            return null;
        const data = yield resp.json();
        const candidates = data.results || [];
        let best = null;
        let bestScore = 0;
        const sanitizedName = sanitizeAuthorName(authorName);
        for (const candidate of candidates) {
            const work = canonicalizeOpenAlexWork(candidate);
            if (!work)
                continue;
            const similarity = jaroWinkler(normalizedTitle, normalizeText(work.title));
            if (similarity < TITLE_SIMILARITY_THRESHOLD)
                continue;
            let score = similarity;
            const authorHit = work.authors.some((a) => jaroWinkler(normalizeText(a.displayName), normalizeText(sanitizedName)) > 0.85);
            if (authorHit)
                score += 0.05;
            if (score > bestScore) {
                bestScore = score;
                best = work;
            }
        }
        return best;
    });
}
function resolveWorksFromScholarTitles(authorName, titles) {
    return __awaiter(this, void 0, void 0, function* () {
        const resolvedWorks = [];
        const seen = new Set();
        for (const title of titles) {
            const work = yield resolveWorkByTitle(title, authorName);
            if (work && !seen.has(work.canonicalId)) {
                resolvedWorks.push(work);
                seen.add(work.canonicalId);
            }
            yield delay(POLITE_DELAY_MS);
        }
        return resolvedWorks;
    });
}
function fetchOpenAlexIncomingCitations(work, workRegistry) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const edges = [];
        const openAlexId = work.externalIds.openalexId;
        if (!openAlexId)
            return edges;
        let cursor = '*';
        while (cursor) {
            const url = `${OPENALEX_API_BASE}/works?filter=cites:${openAlexId}&select=id,doi,display_name,publication_year,authorships&per-page=${WORKS_PER_PAGE}&cursor=${cursor}`;
            const resp = yield fetch(url);
            if (!resp.ok)
                break;
            const data = yield resp.json();
            const results = data.results || [];
            for (const result of results) {
                const citingWork = canonicalizeOpenAlexWork(result);
                if (!citingWork)
                    continue;
                workRegistry.set(citingWork.canonicalId, citingWork);
                edges.push({ citing: citingWork, cited: work, provenance: 'openalex' });
            }
            cursor = (_b = (_a = data.meta) === null || _a === void 0 ? void 0 : _a.next_cursor) !== null && _b !== void 0 ? _b : null;
            if (cursor) {
                yield delay(POLITE_DELAY_MS);
            }
        }
        return edges;
    });
}
function fetchOpenCitationsIncoming(work, workRegistry) {
    return __awaiter(this, void 0, void 0, function* () {
        const edges = [];
        const doi = normalizeDoi(work.externalIds.doi);
        if (!doi)
            return edges;
        const resp = yield fetch(`${OPEN_CITATIONS_BASE}/citations/doi/${encodeURIComponent(doi)}`);
        if (!resp.ok)
            return edges;
        const data = yield resp.json();
        if (!Array.isArray(data))
            return edges;
        for (const citation of data) {
            const citingDoi = normalizeDoi(citation.citing);
            if (!citingDoi)
                continue;
            const existing = workRegistry.get(`doi:${citingDoi}`);
            let citingWork = existing;
            if (!citingWork) {
                const fetched = yield fetchOpenAlexWorkByDoi(citingDoi);
                if (fetched) {
                    citingWork = fetched;
                    workRegistry.set(citingWork.canonicalId, citingWork);
                }
            }
            if (!citingWork)
                continue;
            edges.push({ citing: citingWork, cited: work, provenance: 'opencitations' });
        }
        return edges;
    });
}
function fetchCitationEdges(work, workRegistry) {
    return __awaiter(this, void 0, void 0, function* () {
        const [openAlexEdges, openCitationsEdges] = yield Promise.all([
            fetchOpenAlexIncomingCitations(work, workRegistry),
            fetchOpenCitationsIncoming(work, workRegistry),
        ]);
        return [...openAlexEdges, ...openCitationsEdges];
    });
}
function mergeEdges(edgeMap, providerEdges) {
    for (const edge of providerEdges) {
        const key = `${edge.citing.canonicalId}__${edge.cited.canonicalId}`;
        const existing = edgeMap.get(key);
        if (existing) {
            existing.provenance.add(edge.provenance);
        }
        else {
            edgeMap.set(key, {
                citingId: edge.citing.canonicalId,
                citedId: edge.cited.canonicalId,
                provenance: new Set([edge.provenance]),
            });
        }
    }
}
function hasAuthorOverlap(citing, cited) {
    if (!citing.authors.length || !cited.authors.length)
        return false;
    const citingAuthors = new Set(citing.authors.map((a) => a.canonicalId));
    return cited.authors.some((author) => citingAuthors.has(author.canonicalId));
}
function computeSelfCitationMetrics(edgeMap, workRegistry) {
    let total = 0;
    let self = 0;
    for (const edge of edgeMap.values()) {
        const citing = workRegistry.get(edge.citingId);
        const cited = workRegistry.get(edge.citedId);
        if (!citing || !cited)
            continue;
        total += 1;
        if (hasAuthorOverlap(citing, cited)) {
            self += 1;
        }
    }
    return { total, self };
}
function processAuthor(authorName, publicationTitles) {
    return __awaiter(this, void 0, void 0, function* () {
        const sanitizedName = sanitizeAuthorName(authorName);
        const resolvedWorks = yield resolveWorksFromScholarTitles(sanitizedName, publicationTitles);
        if (resolvedWorks.length === 0) {
            return { status: 'error', message: 'Could not resolve any works from Google Scholar titles.' };
        }
        const workRegistry = new Map();
        resolvedWorks.forEach((work) => workRegistry.set(work.canonicalId, work));
        const edgeMap = new Map();
        for (const work of resolvedWorks) {
            const edges = yield fetchCitationEdges(work, workRegistry);
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
    });
}
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'processAuthor') {
        (() => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const response = yield processAuthor(request.authorName, request.publicationTitles);
                sendResponse(response);
            }
            catch (error) {
                const err = error;
                sendResponse({ status: 'error', message: err.message || 'An unknown error occurred.' });
            }
        }))();
        return true;
    }
    return false;
});
export {};
