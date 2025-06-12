// background.ts

// --- NEW: Custom Error for Rate Limiting ---
/**
 * Custom error to be thrown when a 429 status code is received from a DBLP API.
 */
class DblpRateLimitError extends Error {
    constructor(message = "DBLP API rate limit exceeded.") {
        super(message);
        this.name = "DblpRateLimitError";
    }
}

// --- Constants ---
const DBLP_API_AUTHOR_SEARCH_URL = "https://dblp.org/search/author/api";
const DBLP_SPARQL_ENDPOINT = "https://sparql.dblp.org/sparql";
const HEURISTIC_MIN_OVERLAP_COUNT = 2;
const HEURISTIC_SCORE_THRESHOLD = 2.5;
const HEURISTIC_MIN_NAME_SIMILARITY = 0.65;

// --- Type Definitions (from types.ts) ---
// ... (assuming types.ts is available in the project)

// --- Utility Functions ---

/**
 * Strips common academic titles and suffixes from a name string.
 * e.g., "Ahmad Jalal, Ph.D" -> "Ahmad Jalal"
 */
function sanitizeAuthorName(name: string): string {
    let cleaned = name.trim();
    const patterns = [
        /[,\s]+ph\.d\.?$/i,
        /[,\s]+phd$/i,
        /[,\s]+dr\.?$/i,
        /[,\s]+prof\.?$/i,
        /[,\s]+professor$/i,
    ];
    for (const p of patterns) {
        cleaned = cleaned.replace(p, "");
    }
    // Also remove anything in parentheses and collapse extra whitespace
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ");
    return cleaned.trim();
}

function jaroWinkler(s1: string, s2: string): number {
    if (!s1 || !s2) return 0; if (s1 === s2) return 1; let m = 0;
    const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length), s2Matches = new Array(s2.length);
    for (let i = 0; i < s1.length; i++) { const low = Math.max(0, i - range), high = Math.min(i + range + 1, s2.length); for (let j = low; j < high; j++) if (!s2Matches[j] && s1[i] === s2[j]) { s1Matches[i] = true; s2Matches[j] = true; m++; break; } }
    if (m === 0) return 0; let k = 0, t = 0;
    for (let i = 0; i < s1.length; i++) if (s1Matches[i]) { while (!s2Matches[k]) k++; if (s1[i] !== s2[k]) t++; k++; }
    const jaro = (m / s1.length + m / s2.length + (m - t / 2) / m) / 3; let p = 0.1, l = 0;
    if (jaro > 0.7) { while (s1[l] === s2[l] && l < 4) l++; return jaro + l * p * (1 - jaro); }
    return jaro;
}

const normalizeText = (s: string) => s.toLowerCase().replace(/[\.,\/#!$%\^&\*;:{}=\_`~?"“”()\[\]]/g, " ").replace(/\s+/g, ' ').trim();

// --- DBLP Interaction (with updated error handling) ---

/**
 * UPDATED: Executes a SPARQL query, now with rate-limit and network error handling.
 */
async function executeSparqlQuery(query: string): Promise<any> {
    console.log("[BACKGROUND] ---> Executing SPARQL Query:", query);
    const url = `${DBLP_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&output=json`;

    try {
        const response = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } });

        if (response.status === 429) {
            throw new DblpRateLimitError("DBLP's service is busy. Please wait a moment and try again.");
        }
        if (!response.ok) {
            throw new Error(`SPARQL query failed with status ${response.status}`);
        }

        const json = await response.json();
        console.log("[BACKGROUND] ---> SPARQL Response:", json);
        return json;
    } catch (error) {
        if (error instanceof DblpRateLimitError) {
            throw error;
        }
        throw new Error(`A network error occurred while contacting DBLP.`);
    }
}

async function getCitationCounts(authorUri: string): Promise<{ total: number; self: number;}> {
    const totalCitationsQuery = `
        PREFIX dblp: <https://dblp.org/rdf/schema#>
        PREFIX cito: <http://purl.org/spar/cito/>
        SELECT (COUNT(DISTINCT ?cite) as ?count) WHERE {
            ?authored_paper dblp:authoredBy <${authorUri}>.
            ?authored_paper dblp:omid ?authored_omid.
            ?cite cito:hasCitedEntity ?authored_omid.
        }`;

    const selfCitationsQuery = `
        PREFIX dblp: <https://dblp.org/rdf/schema#>
        PREFIX cito: <http://purl.org/spar/cito/>
        SELECT (COUNT(DISTINCT ?cite) as ?count) WHERE {
            ?cited_paper dblp:authoredBy <${authorUri}>; dblp:authoredBy ?any_author; dblp:omid ?cited_omid.
            ?cite cito:hasCitedEntity ?cited_omid; cito:hasCitingEntity ?citing_omid.
            ?citing_paper dblp:omid ?citing_omid; dblp:authoredBy ?any_author.
        }`;

    const [totalResult, selfResult] = await Promise.all([
        executeSparqlQuery(totalCitationsQuery),
        executeSparqlQuery(selfCitationsQuery)
    ]);
    const total = parseInt(totalResult.results.bindings[0]?.count?.value ?? '0', 10);
    const self = parseInt(selfResult.results.bindings[0]?.count?.value ?? '0', 10);
    return { total, self };
}

/**
 * UPDATED: Searches DBLP for author candidates, now with rate-limit and network error handling.
 */
async function searchDblpForCandidates(authorName: string): Promise<any[]> {
    const url = new URL(DBLP_API_AUTHOR_SEARCH_URL);
    url.searchParams.set('q', authorName);
    url.searchParams.set('format', 'json');
    url.searchParams.set('h', '10');

    try {
        const resp = await fetch(url.toString());

        if (resp.status === 429) {
            throw new DblpRateLimitError("DBLP's service is busy. Please wait a moment and try again.");
        }
        if (!resp.ok) {
            console.error(`DBLP author search failed with status: ${resp.status}`);
            return [];
        }
        
        const data = await resp.json();
        const hits = data.result?.hits?.hit;
        return Array.isArray(hits) ? hits : hits ? [hits] : [];
    } catch (error) {
        if (error instanceof DblpRateLimitError) {
            throw error;
        }
        throw new Error(`Busy. Please wait and try again`);
    }
}

function extractPidFromUrl(url: string): string | null {
    let match = url.match(/pid\/([^/]+\/[^.]+)/i); if (match?.[1]) return match[1];
    match = url.match(/pers\/hd\/[a-z0-9]\/([^.]+)/i); if (match?.[1]) return match[1].replace(/=/g, '');
    match = url.match(/pid\/([\w\/-]+)\.html/i); if (match?.[1]) return match[1];
    return null;
}

async function fetchDblpPublications(pid: string): Promise<{ title: string; year: string | null }[]> {
    const authorUri = `https://dblp.org/pid/${pid}`;
    const query = `PREFIX dblp: <https://dblp.org/rdf/schema#> SELECT ?title ?year WHERE { ?paper dblp:authoredBy <${authorUri}> . ?paper dblp:title ?title . OPTIONAL { ?paper dblp:yearOfPublication ?year . } }`;
    const json = await executeSparqlQuery(query);
    return json.results.bindings.map((b: any) => ({ title: b.title.value, year: b.year ? b.year.value : null }));
}

async function findBestDblpProfile(scholarName: string, scholarTitles: string[]): Promise<string | null> {
    const candidates = await searchDblpForCandidates(scholarName);
    let bestPid: string | null = null;
    let highestScore = 0;
    for (const candidate of candidates) {
        const dblpName = candidate.info.author.replace(/\s\d{4}$/, '');
        const nameSimilarity = jaroWinkler(scholarName.toLowerCase(), dblpName.toLowerCase());
        if (nameSimilarity < HEURISTIC_MIN_NAME_SIMILARITY) continue;
        const pid = extractPidFromUrl(candidate.info.url);
        if (!pid) continue;
        let currentScore = nameSimilarity * 2.0;
        let overlapCount = 0;
        const dblpPublications = await fetchDblpPublications(pid);
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
}

// --- Listener (with updated error catching) ---
/**
 * UPDATED: The main listener now catches the DblpRateLimitError specifically.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processAuthor") {
        (async () => {
            try {
                const sanitizedName = sanitizeAuthorName(request.authorName);
                const bestPid = await findBestDblpProfile(sanitizedName, request.publicationTitles);

                if (!bestPid) {
                    throw new Error('Could not find a matching DBLP profile.');
                }

                const authorUri = `https://dblp.org/pid/${bestPid}`;
                const { total, self } = await getCitationCounts(authorUri);
                const percentage = total > 0 ? (self / total) * 100 : 0;

                sendResponse({
                    status: 'success',
                    selfCitations: self,
                    totalCitations: total,
                    percentage: percentage,
                    message: `(From DBLP PID: ${bestPid})`
                });

            } catch (error) {
                // Catch the specific rate limit error and send a unique response
                if (error instanceof DblpRateLimitError) {
                    sendResponse({ status: 'rate_limit_error', message: error.message });
                } else {
                    // Handle all other errors generically
                    sendResponse({ status: 'error', message: (error as Error).message || 'An unknown error occurred.' });
                }
            }
        })();
        return true; // Required for asynchronous sendResponse
    }
});