"use strict";
// background.ts
//
// FINAL, VERIFIED VERSION: This version fixes all TypeScript compilation errors
// by using an explicit helper function to safely extract author IDs, guaranteeing
// correct types and resolving all build issues.
//
// UPDATED: The main listener logic is now more robust. If the DBLP lookup
// fails for any reason, it automatically falls back to the OpenAlex lookup
// instead of immediately returning an error.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// --- DBLP: Custom Error ---
class DblpRateLimitError extends Error {
    constructor(message = "DBLP API rate limit exceeded.") {
        super(message);
        this.name = "DblpRateLimitError";
    }
}
// --- Shared Constants ---
const HEURISTIC_MIN_OVERLAP_COUNT = 2;
const HEURISTIC_SCORE_THRESHOLD = 2.5;
const HEURISTIC_MIN_NAME_SIMILARITY = 0.65;
// --- DBLP: Constants ---
const DBLP_API_AUTHOR_SEARCH_URL = "https://dblp.org/search/author/api";
const DBLP_SPARQL_ENDPOINT = "https://sparql.dblp.org/sparql";
// --- OpenAlex: Constants ---
const OPENALEX_API_BASE = "https://api.openalex.org";
const WORKS_PER_PAGE = 200;
const POLITE_DELAY_MS = 50;
// in background.ts
function sanitizeAuthorName(name) {
    let cleaned = name.trim();
    const commaIndex = cleaned.indexOf(',');
    if (commaIndex !== -1) {
        cleaned = cleaned.substring(0, commaIndex);
    }
    const prefixPatterns = [
        /^professor\s*/i,
        /^prof\.?\s*/i,
        /^dr\.?\s*/i
    ];
    for (const p of prefixPatterns) {
        cleaned = cleaned.replace(p, "");
    }
    cleaned = cleaned.replace(/\./g, "");
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ");
    return cleaned.trim();
}
function jaroWinkler(s1, s2) {
    if (!s1 || !s2)
        return 0;
    if (s1 === s2)
        return 1;
    let m = 0;
    const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length), s2Matches = new Array(s2.length);
    for (let i = 0; i < s1.length; i++) {
        const low = Math.max(0, i - range), high = Math.min(i + range + 1, s2.length);
        for (let j = low; j < high; j++)
            if (!s2Matches[j] && s1[i] === s2[j]) {
                s1Matches[i] = true;
                s2Matches[j] = true;
                m++;
                break;
            }
    }
    if (m === 0)
        return 0;
    let k = 0, t = 0;
    for (let i = 0; i < s1.length; i++)
        if (s1Matches[i]) {
            while (!s2Matches[k])
                k++;
            if (s1[i] !== s2[k])
                t++;
            k++;
        }
    const jaro = (m / s1.length + m / s2.length + (m - t / 2) / m) / 3;
    let p = 0.1, l = 0;
    if (jaro > 0.7) {
        while (s1[l] === s2[l] && l < 4)
            l++;
        return jaro + l * p * (1 - jaro);
    }
    return jaro;
}
const normalizeText = (s) => {
    if (!s)
        return ""; // Return an empty string if the input is null or undefined
    return s.toLowerCase().replace(/[\.,\/#!$%\^&\*;:{}=\_`~?"“”()\[\]]/g, " ").replace(/\s+/g, ' ').trim();
};
// --- DBLP: Functions ---
function executeSparqlQuery(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${DBLP_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&output=json`;
        try {
            const response = yield fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } });
            if (response.status === 429)
                throw new DblpRateLimitError("DBLP's service is busy.");
            if (!response.ok)
                throw new Error(`SPARQL query failed with status ${response.status}`);
            return yield response.json();
        }
        catch (error) {
            if (error instanceof DblpRateLimitError)
                throw error;
            throw new Error(`A network error occurred while contacting DBLP.`);
        }
    });
}
function getDblpCitationCounts(authorUri) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const totalCitationsQuery = `PREFIX dblp: <https://dblp.org/rdf/schema#> PREFIX cito: <http://purl.org/spar/cito/> SELECT (COUNT(DISTINCT ?cite) as ?count) WHERE { ?authored_paper dblp:authoredBy <${authorUri}>; dblp:omid ?authored_omid. ?cite cito:hasCitedEntity ?authored_omid. }`;
        const selfCitationsQuery = `PREFIX dblp: <https://dblp.org/rdf/schema#> PREFIX cito: <http://purl.org/spar/cito/> SELECT (COUNT(DISTINCT ?cite) as ?count) WHERE { ?cited_paper dblp:authoredBy <${authorUri}>; dblp:authoredBy ?any_author; dblp:omid ?cited_omid. ?cite cito:hasCitedEntity ?cited_omid; cito:hasCitingEntity ?citing_omid. ?citing_paper dblp:omid ?citing_omid; dblp:authoredBy ?any_author. }`;
        const [totalResult, selfResult] = yield Promise.all([executeSparqlQuery(totalCitationsQuery), executeSparqlQuery(selfCitationsQuery)]);
        const total = parseInt((_c = (_b = (_a = totalResult.results.bindings[0]) === null || _a === void 0 ? void 0 : _a.count) === null || _b === void 0 ? void 0 : _b.value) !== null && _c !== void 0 ? _c : '0', 10);
        const self = parseInt((_f = (_e = (_d = selfResult.results.bindings[0]) === null || _d === void 0 ? void 0 : _d.count) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : '0', 10);
        return { total, self };
    });
}
function searchDblpForCandidates(authorName) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const url = new URL(DBLP_API_AUTHOR_SEARCH_URL);
        url.searchParams.set('q', authorName);
        url.searchParams.set('format', 'json');
        url.searchParams.set('h', '10');
        try {
            const resp = yield fetch(url.toString());
            if (resp.status === 429)
                throw new DblpRateLimitError("DBLP's service is busy.");
            if (!resp.ok)
                return [];
            const data = yield resp.json();
            const hits = (_b = (_a = data.result) === null || _a === void 0 ? void 0 : _a.hits) === null || _b === void 0 ? void 0 : _b.hit;
            return Array.isArray(hits) ? hits : hits ? [hits] : [];
        }
        catch (error) {
            if (error instanceof DblpRateLimitError)
                throw error;
            throw new Error(`A network error occurred while contacting DBLP.`);
        }
    });
}
function extractPidFromUrl(url) {
    let match = url.match(/pid\/([^/]+\/[^.]+)/i);
    if (match === null || match === void 0 ? void 0 : match[1])
        return match[1];
    match = url.match(/pers\/hd\/[a-z0-9]\/([^.]+)/i);
    if (match === null || match === void 0 ? void 0 : match[1])
        return match[1].replace(/=/g, '');
    match = url.match(/pid\/([\w\/-]+)\.html/i);
    if (match === null || match === void 0 ? void 0 : match[1])
        return match[1];
    return null;
}
function fetchDblpPublications(pid) {
    return __awaiter(this, void 0, void 0, function* () {
        const authorUri = `https://dblp.org/pid/${pid}`;
        const query = `PREFIX dblp: <https://dblp.org/rdf/schema#> SELECT ?title ?year WHERE { ?paper dblp:authoredBy <${authorUri}> . ?paper dblp:title ?title . OPTIONAL { ?paper dblp:yearOfPublication ?year . } }`;
        const json = yield executeSparqlQuery(query);
        return json.results.bindings.map((b) => ({ title: b.title.value, year: b.year ? b.year.value : null }));
    });
}
function findBestDblpProfile(scholarName, scholarTitles) {
    return __awaiter(this, void 0, void 0, function* () {
        const candidates = yield searchDblpForCandidates(scholarName);
        let bestPid = null;
        let highestScore = 0;
        for (const candidate of candidates) {
            const dblpName = candidate.info.author.replace(/\s\d{4}$/, '');
            const nameSimilarity = jaroWinkler(scholarName.toLowerCase(), dblpName.toLowerCase());
            if (nameSimilarity < HEURISTIC_MIN_NAME_SIMILARITY)
                continue;
            const pid = extractPidFromUrl(candidate.info.url);
            if (!pid)
                continue;
            let currentScore = nameSimilarity * 2.0;
            let overlapCount = 0;
            const dblpPublications = yield fetchDblpPublications(pid);
            for (const scholarTitle of scholarTitles) {
                for (const dblpPub of dblpPublications) {
                    if (jaroWinkler(normalizeText(scholarTitle), normalizeText(dblpPub.title)) > 0.85) {
                        overlapCount++;
                        currentScore += 1.0;
                        break;
                    }
                }
            }
            if (currentScore > highestScore && overlapCount >= HEURISTIC_MIN_OVERLAP_COUNT) {
                highestScore = currentScore;
                bestPid = pid;
            }
        }
        return (bestPid && highestScore >= HEURISTIC_SCORE_THRESHOLD) ? bestPid : null;
    });
}
// --- OpenAlex: Functions ---
/**
 * NEW HELPER FUNCTION: Safely extracts author IDs from an authorships array
 * and returns a clean Set of strings, satisfying the TypeScript compiler.
 */
function getAuthorIdsFromAuthorships(authorships) {
    var _a, _b;
    const idSet = new Set();
    if (!authorships) {
        return idSet;
    }
    for (const authorship of authorships) {
        const authorId = (_b = (_a = authorship.author) === null || _a === void 0 ? void 0 : _a.id) === null || _b === void 0 ? void 0 : _b.replace("https://openalex.org/", "");
        if (authorId && typeof authorId === 'string') {
            idSet.add(authorId);
        }
    }
    return idSet;
}
function searchOpenAlexForCandidates(authorName) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${OPENALEX_API_BASE}/authors?search=${encodeURIComponent(authorName)}`;
        const resp = yield fetch(url);
        if (!resp.ok)
            throw new Error(`OpenAlex author search failed: ${resp.status}`);
        const data = yield resp.json();
        return data.results || [];
    });
}
function fetchOpenAlexPublications(authorId) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${OPENALEX_API_BASE}/works?filter=author.id:${authorId}&select=display_name,publication_year&per-page=200`;
        try {
            const resp = yield fetch(url);
            if (!resp.ok)
                return [];
            const data = yield resp.json();
            return (data.results || []).map((work) => ({
                title: work.display_name,
                year: work.publication_year ? String(work.publication_year) : null,
            }));
        }
        catch (_a) {
            return [];
        }
    });
}
function findBestOpenAlexProfile(scholarName, scholarTitles) {
    return __awaiter(this, void 0, void 0, function* () {
        const candidates = yield searchOpenAlexForCandidates(scholarName);
        let bestAuthorId = null;
        let highestScore = -1;
        for (const candidate of candidates) {
            const openAlexName = candidate.display_name;
            const nameSimilarity = jaroWinkler(scholarName.toLowerCase(), openAlexName.toLowerCase());
            if (nameSimilarity < HEURISTIC_MIN_NAME_SIMILARITY)
                continue;
            const authorId = candidate.id.replace("https://openalex.org/", "");
            if (!authorId)
                continue;
            let currentScore = nameSimilarity * 2.0;
            let overlapCount = 0;
            const openAlexPublications = yield fetchOpenAlexPublications(authorId);
            for (const scholarTitle of scholarTitles) {
                for (const oaPub of openAlexPublications) {
                    if (jaroWinkler(normalizeText(scholarTitle), normalizeText(oaPub.title)) > 0.85) {
                        overlapCount++;
                        currentScore += 1.0;
                        break;
                    }
                }
            }
            if (currentScore > highestScore && overlapCount >= HEURISTIC_MIN_OVERLAP_COUNT) {
                highestScore = currentScore;
                bestAuthorId = authorId;
            }
        }
        return (bestAuthorId && highestScore >= HEURISTIC_SCORE_THRESHOLD) ? bestAuthorId : null;
    });
}
function getOpenAlexCitationCounts(authorId) {
    return __awaiter(this, void 0, void 0, function* () {
        const authorWorks = new Map();
        let page = 1;
        let hasMorePages = true;
        while (hasMorePages) {
            const authorWorksUrl = `${OPENALEX_API_BASE}/works?filter=author.id:${authorId}&select=id,authorships&per-page=${WORKS_PER_PAGE}&page=${page}`;
            const authorWorksResp = yield fetch(authorWorksUrl);
            if (!authorWorksResp.ok)
                throw new Error(`Could not fetch author's own works (page ${page}).`);
            const authorWorksData = yield authorWorksResp.json();
            const works = authorWorksData.results || [];
            if (works.length > 0) {
                for (const work of works) {
                    const workId = work.id.replace("https://openalex.org/", "");
                    const authorIds = getAuthorIdsFromAuthorships(work.authorships);
                    authorWorks.set(workId, authorIds);
                }
                page++;
            }
            else {
                hasMorePages = false;
            }
        }
        if (authorWorks.size === 0)
            return { total: 0, self: 0 };
        let totalCitationMentions = 0;
        let selfCitationMentions = 0;
        for (const [citedWorkId, citedWorkAuthorsSet] of authorWorks.entries()) {
            const citingWorksUrl = `${OPENALEX_API_BASE}/works?filter=cites:${citedWorkId}&select=id,authorships`;
            const resp = yield fetch(citingWorksUrl);
            if (resp.ok) {
                const data = yield resp.json();
                const citingWorks = data.results || [];
                totalCitationMentions += citingWorks.length;
                for (const citingWork of citingWorks) {
                    const citingWorkAuthors = getAuthorIdsFromAuthorships(citingWork.authorships);
                    const hasOverlap = [...citingWorkAuthors].some(id => citedWorkAuthorsSet.has(id));
                    if (hasOverlap)
                        selfCitationMentions++;
                }
            }
            else {
                if (resp.status === 429)
                    yield new Promise(resolve => setTimeout(resolve, 1000));
            }
            yield new Promise(resolve => setTimeout(resolve, POLITE_DELAY_MS));
        }
        return { total: totalCitationMentions, self: selfCitationMentions };
    });
}
// --- Main Listener with Fallback Logic ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processAuthor") {
        (() => __awaiter(void 0, void 0, void 0, function* () {
            const sanitizedName = sanitizeAuthorName(request.authorName);
            // --- DBLP Attempt ---
            try {
                console.log("Step 1: Attempting to find author on DBLP...");
                const bestPid = yield findBestDblpProfile(sanitizedName, request.publicationTitles);
                if (bestPid) {
                    console.log(`---> DBLP profile found: ${bestPid}. Fetching DBLP citations...`);
                    const authorUri = `https://dblp.org/pid/${bestPid}`;
                    const { total, self } = yield getDblpCitationCounts(authorUri);
                    const percentage = total > 0 ? (self / total) * 100 : 0;
                    sendResponse({
                        status: 'success',
                        selfCitations: self,
                        totalCitations: total,
                        percentage: percentage,
                        message: `(From DBLP PID: ${bestPid})`
                    });
                    return; // Exit after successful DBLP processing.
                }
                // If no profile is found, log it and let it fall through to OpenAlex.
                console.log("--- DBLP profile not found. Proceeding to OpenAlex fallback. ---");
            }
            catch (error) {
                // If DBLP fails for ANY reason (rate limit, network error, etc.),
                // log the error and fall back to OpenAlex.
                const err = error;
                console.warn(`DBLP attempt failed: ${err.message}. Switching to OpenAlex fallback.`);
            }
            // --- OpenAlex Fallback ---
            try {
                console.log("Step 2: Switching to OpenAlex fallback...");
                const bestOpenAlexId = yield findBestOpenAlexProfile(sanitizedName, request.publicationTitles);
                if (bestOpenAlexId) {
                    console.log(`---> OpenAlex profile found: ${bestOpenAlexId}. Fetching OpenAlex citations...`);
                    const { total, self } = yield getOpenAlexCitationCounts(bestOpenAlexId);
                    const percentage = total > 0 ? (self / total) * 100 : 0;
                    sendResponse({
                        status: 'success',
                        selfCitations: self,
                        totalCitations: total,
                        percentage: percentage,
                        message: `(From OpenAlex ID: ${bestOpenAlexId})`
                    });
                }
                else {
                    throw new Error('Could not find a matching profile on DBLP or OpenAlex.');
                }
            }
            catch (error) {
                // If OpenAlex also fails, then we send the final error.
                const err = error;
                sendResponse({ status: 'error', message: err.message || 'An unknown error occurred.' });
            }
        }))();
        return true; // Keep the listener alive for the async response
    }
});
