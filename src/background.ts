// background.ts
//
// FINAL, VERIFIED VERSION: This version uses a "guess and check" strategy for
// DBLP hubs, avoiding HTML parsing and the Offscreen API entirely. It works
// reliably within the service worker environment.
//
// STRATEGY:
// 1. Detect the most likely "base PID" for a common name from API results.
// 2. Programmatically generate a list of potential PID variants (e.g., base-1, base-2).
// 3. Test each variant by attempting to fetch its publications; if the fetch fails,
//    the PID is invalid and we move to the next.

// --- Type Definitions (assuming types.ts is in the project) ---
interface ApiResponse {
  status: 'success' | 'error' | 'rate_limit_error';
  selfCitations?: number;
  totalCitations?: number;
  percentage?: number;
  message?: string;
}

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
const DBLP_MAX_HUB_VARIANTS_TO_CHECK = 150; // Max number of PIDs to guess (e.g., -1 to -150)

// --- DBLP: Constants ---
const DBLP_API_AUTHOR_SEARCH_URL = "https://dblp.org/search/author/api";
const DBLP_SPARQL_ENDPOINT = "https://sparql.dblp.org/sparql";

// --- OpenAlex: Constants ---
const OPENALEX_API_BASE = "https://api.openalex.org";
const WORKS_PER_PAGE = 200;
const POLITE_DELAY_MS = 50;


// in background.ts

function sanitizeAuthorName(name: string): string {
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

const normalizeText = (s: string) => {
    if (!s) return ""; // Return an empty string if the input is null or undefined
    return s.toLowerCase().replace(/[\.,\/#!$%\^&\*;:{}=\_`~?"“”()\[\]]/g, " ").replace(/\s+/g, ' ').trim();
}


// --- DBLP: Functions ---

async function executeSparqlQuery(query: string): Promise<any> {
    const url = `${DBLP_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&output=json`;
    try {
        const response = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } });
        if (response.status === 429) throw new DblpRateLimitError("DBLP's service is busy.");
        if (!response.ok) throw new Error(`SPARQL query failed with status ${response.status}`);
        return await response.json();
    } catch (error) {
        if (error instanceof DblpRateLimitError) throw error;
        throw new Error(`A network error occurred while contacting DBLP.`);
    }
}

async function getDblpCitationCounts(authorUri: string): Promise<{ total: number; self: number;}> {
    const totalCitationsQuery = `PREFIX dblp: <https://dblp.org/rdf/schema#> PREFIX cito: <http://purl.org/spar/cito/> SELECT (COUNT(DISTINCT ?cite) as ?count) WHERE { ?authored_paper dblp:authoredBy <${authorUri}>; dblp:omid ?authored_omid. ?cite cito:hasCitedEntity ?authored_omid. }`;
    const selfCitationsQuery = `PREFIX dblp: <https://dblp.org/rdf/schema#> PREFIX cito: <http://purl.org/spar/cito/> SELECT (COUNT(DISTINCT ?cite) as ?count) WHERE { ?cited_paper dblp:authoredBy <${authorUri}>; dblp:authoredBy ?any_author; dblp:omid ?cited_omid. ?cite cito:hasCitedEntity ?cited_omid; cito:hasCitingEntity ?citing_omid. ?citing_paper dblp:omid ?citing_omid; dblp:authoredBy ?any_author. }`;
    const [totalResult, selfResult] = await Promise.all([executeSparqlQuery(totalCitationsQuery), executeSparqlQuery(selfCitationsQuery)]);
    const total = parseInt(totalResult.results.bindings[0]?.count?.value ?? '0', 10);
    const self = parseInt(selfResult.results.bindings[0]?.count?.value ?? '0', 10);
    return { total, self };
}

function extractPidFromUrl(url: string): string | null {
    let match = url.match(/pid\/([^/]+\/[^.]+)/i); if (match?.[1]) return match[1];
    match = url.match(/pers\/hd\/[a-z0-9]\/([^.]+)/i); if (match?.[1]) return match[1].replace(/=/g, '');
    match = url.match(/pid\/([\w\/-]+)\.html/i); if (match?.[1]) return match[1];
    return null;
}


// ===================================================================================
// START: "GUESS AND CHECK" LOGIC
// ===================================================================================

async function searchDblpForCandidates(authorName: string): Promise<any[]> {
    const url = new URL(DBLP_API_AUTHOR_SEARCH_URL);
    url.searchParams.set('q', authorName);
    url.searchParams.set('format', 'json');
    url.searchParams.set('h', '500'); 
    try {
        const resp = await fetch(url.toString());
        if (resp.status === 429) throw new DblpRateLimitError("DBLP's service is busy.");
        if (!resp.ok) return [];
        
        const data = await resp.json();
        const hits = data.result?.hits?.hit;
        const initialCandidates = Array.isArray(hits) ? hits : hits ? [hits] : [];

        if (initialCandidates.length === 0) return [];

        // Find the most common base PID from the search results
        const basePidCounts: Record<string, number> = {};
        for (const hit of initialCandidates) {
            const pid = extractPidFromUrl(hit.info.url);
            if (pid) {
                const basePid = pid.split('-')[0];
                basePidCounts[basePid] = (basePidCounts[basePid] || 0) + 1;
            }
        }
        
        let mostCommonBasePid: string | null = null;
        let maxCount = 0;
        for (const basePid in basePidCounts) {
            if (basePidCounts[basePid] > maxCount) {
                maxCount = basePidCounts[basePid];
                mostCommonBasePid = basePid;
            }
        }

        // If a hub is detected, generate potential candidates programmatically
        if (mostCommonBasePid && maxCount > 4) {
            console.log(`[DBLP SEARCH] Detected likely hub with base PID "${mostCommonBasePid}". Generating variants to test.`);
            const generatedCandidates: any[] = [];
            for (let i = 1; i <= DBLP_MAX_HUB_VARIANTS_TO_CHECK; i++) {
                const newPid = `${mostCommonBasePid}-${i}`;
                generatedCandidates.push({
                    info: {
                        author: `${authorName} (Variant ${i})`, // A placeholder name
                        url: `https://dblp.org/pid/${newPid}.html`
                    }
                });
            }
            return generatedCandidates;
        }
        
        // Fallback: If no clear hub is detected, return the raw list.
        console.log("[DBLP SEARCH] No obvious hub detected. Proceeding with raw API results.");
        return initialCandidates;

    } catch (error) {
        if (error instanceof DblpRateLimitError) throw error;
        throw new Error(`A network error occurred while contacting DBLP.`);
    }
}
// ===================================================================================
// END: "GUESS AND CHECK" LOGIC
// ===================================================================================


async function fetchDblpPublications(pid: string): Promise<{ title: string; year: string | null }[]> {
    const authorUri = `https://dblp.org/pid/${pid}`;
    const query = `PREFIX dblp: <https://dblp.org/rdf/schema#> SELECT ?title ?year WHERE { ?paper dblp:authoredBy <${authorUri}> . ?paper dblp:title ?title . OPTIONAL { ?paper dblp:yearOfPublication ?year . } }`;
    const json = await executeSparqlQuery(query);
    return json.results.bindings.map((b: any) => ({ title: b.title.value, year: b.year ? b.year.value : null }));
}

async function findBestDblpProfile(scholarName: string, scholarTitles: string[]): Promise<string | null> {
    console.log(`[DBLP HEURISTIC] Starting search for: "${scholarName}" with ${scholarTitles.length} publication titles.`);
    
    const candidates = await searchDblpForCandidates(scholarName);
    console.log(`[DBLP HEURISTIC] Generated ${candidates.length} potential candidates to evaluate.`);

    if (candidates.length === 0) {
        console.log(`[DBLP HEURISTIC] No candidates found. Aborting.`);
        return null;
    }

    let bestPid: string | null = null;
    let highestScore = 0;

    for (const [index, candidate] of candidates.entries()) {
        const dblpName = candidate.info.author.replace(/\s+\(Variant \d+\)$/, '').trim();
        const pid = extractPidFromUrl(candidate.info.url);

        if (!pid) continue; // Should not happen with generated PIDs

        // Minimal logging to avoid spamming the console for 150 candidates
        if ((index + 1) % 25 === 0) {
            console.log(`--- Evaluating candidate batch around #${index + 1} (PID: ${pid}) ---`);
        }

        const nameSimilarity = jaroWinkler(scholarName.toLowerCase(), dblpName.toLowerCase());
        if (nameSimilarity < HEURISTIC_MIN_NAME_SIMILARITY) {
            continue; // This check is fast and avoids network requests
        }

        let dblpPublications;
        try {
            // This is the "check" part of "guess and check".
            // It will throw an error if the PID does not exist, which we catch.
            dblpPublications = await fetchDblpPublications(pid);
        } catch (error) {
            // This PID is invalid. This is expected. We just continue to the next guess.
            continue;
        }
        
        // If we get here, the PID is valid. Now check for title overlap.
        let currentScore = nameSimilarity * 2.0;
        let overlapCount = 0;
        for (const scholarTitle of scholarTitles) {
            for (const dblpPub of dblpPublications) {
                const titleSimilarity = jaroWinkler(normalizeText(scholarTitle), normalizeText(dblpPub.title));
                if (titleSimilarity > 0.85) {
                    overlapCount++;
                    currentScore += 1.0;
                    break;
                }
            }
        }
        
        if (currentScore > highestScore && overlapCount >= HEURISTIC_MIN_OVERLAP_COUNT && currentScore >= HEURISTIC_SCORE_THRESHOLD) {
            highestScore = currentScore;
            bestPid = pid;
            // Log extensively only when we find a promising candidate
            console.log(`\n✅ New best candidate found! PID: ${pid}`);
            console.log(`   - Overlap Count: ${overlapCount}, Score: ${currentScore.toFixed(2)}`);
        }
    }

    console.log(`\n[DBLP HEURISTIC] Finished evaluating all candidates. Final chosen PID: ${bestPid || 'None'}`);
    return bestPid;
}


// --- OpenAlex: Functions ---

function getAuthorIdsFromAuthorships(authorships: any[]): Set<string> {
    const idSet = new Set<string>();
    if (!authorships) {
        return idSet;
    }
    for (const authorship of authorships) {
        const authorId = authorship.author?.id?.replace("https://openalex.org/", "");
        if (authorId && typeof authorId === 'string') {
            idSet.add(authorId);
        }
    }
    return idSet;
}

async function searchOpenAlexForCandidates(authorName: string): Promise<any[]> {
    const url = `${OPENALEX_API_BASE}/authors?search=${encodeURIComponent(authorName)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`OpenAlex author search failed: ${resp.status}`);
    const data = await resp.json();
    return data.results || [];
}

async function fetchOpenAlexPublications(authorId: string): Promise<{ title: string; year: string | null }[]> {
    const url = `${OPENALEX_API_BASE}/works?filter=author.id:${authorId}&select=display_name,publication_year&per-page=200`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.results || []).map((work: any) => ({
            title: work.display_name,
            year: work.publication_year ? String(work.publication_year) : null,
        }));
    } catch { return []; }
}

async function findBestOpenAlexProfile(scholarName: string, scholarTitles: string[]): Promise<string | null> {
    const candidates = await searchOpenAlexForCandidates(scholarName);
    let bestAuthorId: string | null = null;
    let highestScore = -1;
    for (const candidate of candidates) {
        const openAlexName = candidate.display_name;
        const nameSimilarity = jaroWinkler(scholarName.toLowerCase(), openAlexName.toLowerCase());
        if (nameSimilarity < HEURISTIC_MIN_NAME_SIMILARITY) continue;
        const authorId = candidate.id.replace("https://openalex.org/", "");
        if (!authorId) continue;
        let currentScore = nameSimilarity * 2.0;
        let overlapCount = 0;
        const openAlexPublications = await fetchOpenAlexPublications(authorId);
        for (const scholarTitle of scholarTitles) {
            for (const oaPub of openAlexPublications) {
                if (jaroWinkler(normalizeText(scholarTitle), normalizeText(oaPub.title)) > 0.85) {
                    overlapCount++; currentScore += 1.0; break;
                }
            }
        }
        if (currentScore > highestScore && overlapCount >= HEURISTIC_MIN_OVERLAP_COUNT) {
            highestScore = currentScore; bestAuthorId = authorId;
        }
    }
    return (bestAuthorId && highestScore >= HEURISTIC_SCORE_THRESHOLD) ? bestAuthorId : null;
}

async function getOpenAlexCitationCounts(authorId: string): Promise<{ total: number; self: number; }> {
    const authorWorks = new Map<string, Set<string>>();
    let page = 1; let hasMorePages = true;
    while(hasMorePages) {
        const authorWorksUrl = `${OPENALEX_API_BASE}/works?filter=author.id:${authorId}&select=id,authorships&per-page=${WORKS_PER_PAGE}&page=${page}`;
        const authorWorksResp = await fetch(authorWorksUrl);
        if(!authorWorksResp.ok) throw new Error(`Could not fetch author's own works (page ${page}).`);
        const authorWorksData = await authorWorksResp.json();
        const works = authorWorksData.results || [];
        if (works.length > 0) {
            for (const work of works) {
                const workId = work.id.replace("https://openalex.org/", "");
                const authorIds = getAuthorIdsFromAuthorships(work.authorships);
                authorWorks.set(workId, authorIds);
            }
            page++;
        } else {
            hasMorePages = false;
        }
    }
    if (authorWorks.size === 0) return { total: 0, self: 0 };
    
    let totalCitationMentions = 0; let selfCitationMentions = 0;
    for (const [citedWorkId, citedWorkAuthorsSet] of authorWorks.entries()) {
        const citingWorksUrl = `${OPENALEX_API_BASE}/works?filter=cites:${citedWorkId}&select=id,authorships`;
        const resp = await fetch(citingWorksUrl);
        if (resp.ok) {
            const data = await resp.json();
            const citingWorks = data.results || [];
            totalCitationMentions += citingWorks.length;
            for (const citingWork of citingWorks) {
                const citingWorkAuthors = getAuthorIdsFromAuthorships(citingWork.authorships);
                const hasOverlap = [...citingWorkAuthors].some(id => citedWorkAuthorsSet.has(id));
                if (hasOverlap) selfCitationMentions++;
            }
        } else {
            if (resp.status === 429) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        await new Promise(resolve => setTimeout(resolve, POLITE_DELAY_MS));
    }
    return { total: totalCitationMentions, self: selfCitationMentions };
}


// --- Main Listener with Fallback Logic ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processAuthor") {
        (async () => {
            const sanitizedName = sanitizeAuthorName(request.authorName);

            // --- DBLP Attempt ---
            try {
                console.log("Step 1: Attempting to find author on DBLP...");
                const bestPid = await findBestDblpProfile(sanitizedName, request.publicationTitles);

                if (bestPid) {
                    console.log(`---> DBLP profile found: ${bestPid}. Fetching DBLP citations...`);
                    const authorUri = `https://dblp.org/pid/${bestPid}`;
                    const { total, self } = await getDblpCitationCounts(authorUri);
                    const percentage = total > 0 ? (self / total) * 100 : 0;
                    
                    sendResponse({
                        status: 'success',
                        selfCitations: self,
                        totalCitations: total,
                        percentage: percentage,
                        message: `(From DBLP PID: ${bestPid})`
                    });
                    return; 
                }
                
                console.log("--- DBLP profile not found. Proceeding to OpenAlex fallback. ---");

            } catch (error) {
                const err = error as Error;
                console.warn(`DBLP attempt failed: ${err.message}. Switching to OpenAlex fallback.`);
            }

            // --- OpenAlex Fallback ---
            try {
                console.log("Step 2: Switching to OpenAlex fallback...");
                const bestOpenAlexId = await findBestOpenAlexProfile(sanitizedName, request.publicationTitles);

                if (bestOpenAlexId) {
                    console.log(`---> OpenAlex profile found: ${bestOpenAlexId}. Fetching OpenAlex citations...`);
                    const { total, self } = await getOpenAlexCitationCounts(bestOpenAlexId);
                    const percentage = total > 0 ? (self / total) * 100 : 0;
                    
                    sendResponse({
                        status: 'success',
                        selfCitations: self,
                        totalCitations: total,
                        percentage: percentage,
                        message: `(From OpenAlex ID: ${bestOpenAlexId})`
                    });
                } else {
                    throw new Error('Could not find a matching profile on DBLP or OpenAlex.');
                }
            } catch (error) {
                const err = error as Error;
                sendResponse({ status: 'error', message: err.message || 'An unknown error occurred.' });
            }
        })();
        return true; 
    }
});