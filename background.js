"use strict";
// src/background.ts  – MV3 service-worker (ES module)
// ─── External End-Points ─────────────────────────────────────────
const DBLP_API_AUTHOR_SEARCH_URL = "https://dblp.org/search/author/api";
const DBLP_SPARQL_ENDPOINT = "https://sparql.dblp.org/sparql";
// ─── Heuristic constants ────────────────────────────────────────
const DBLP_SEARCH_MAX_HITS = 10;
const DBLP_HEURISTIC_MIN_OVERLAP_COUNT = 3;
const DBLP_HEURISTIC_MIN_NAME_SIMILARITY = 0.65;
// ─── Tiny Jaro-Winkler for name similarity ──────────────────────
function jaroWinkler(a, b) {
    if (a === b)
        return 1;
    const range = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const s1 = [...a], s2 = [...b];
    const m1 = new Array(s1.length).fill(false);
    const m2 = new Array(s2.length).fill(false);
    let matches = 0;
    for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - range);
        const end = Math.min(i + range + 1, s2.length);
        for (let j = start; j < end; j++) {
            if (!m2[j] && s1[i] === s2[j]) {
                m1[i] = m2[j] = true;
                matches++;
                break;
            }
        }
    }
    if (!matches)
        return 0;
    const ms1 = [], ms2 = [];
    for (let i = 0; i < s1.length; i++)
        if (m1[i])
            ms1.push(s1[i]);
    for (let j = 0; j < s2.length; j++)
        if (m2[j])
            ms2.push(s2[j]);
    let transpositions = 0;
    for (let k = 0; k < ms1.length; k++)
        if (ms1[k] !== ms2[k])
            transpositions++;
    const jw = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
    // prefix scaling (p = 0.1, l = common prefix ≤ 4)
    let l = 0;
    while (l < 4 && a[l] === b[l])
        l++;
    return jw + l * 0.1 * (1 - jw);
}
// ─── Helpers ────────────────────────────────────────────────────
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
function extractPid(url) {
    return (url.match(/pers\/hd\/[a-z0-9]\/([^.]+)/i)?.[1]?.replace(/=/g, "") ??
        url.match(/pid\/([^/]+\/[^.]+)/i)?.[1] ??
        url.match(/pid\/([\w/-]+)\.html/i)?.[1] ??
        null);
}
function pidToUri(pid) {
    return `https://dblp.org/pid/${pid}`;
}
// ─── DBLP author search ─────────────────────────────────────────
async function searchAuthor(name) {
    const u = new URL(DBLP_API_AUTHOR_SEARCH_URL);
    u.searchParams.set("q", name);
    u.searchParams.set("h", DBLP_SEARCH_MAX_HITS.toString());
    u.searchParams.set("c", "3");
    u.searchParams.set("format", "json");
    const r = await fetch(u.toString());
    if (!r.ok)
        return [];
    const data = await r.json();
    const arr = data.result.hits?.hit;
    const hits = Array.isArray(arr) ? arr : arr ? [arr] : [];
    return hits.flatMap((h) => {
        const pid = h?.info?.url ? extractPid(h.info.url) : null;
        const fullName = h?.info?.author;
        return pid && fullName ? [{ pid, fullName }] : [];
    });
}
// ─── SPARQL helpers ─────────────────────────────────────────────
async function runSparql(q) {
    const url = `${DBLP_SPARQL_ENDPOINT}?query=${encodeURIComponent(q)}&output=json`;
    const h = { "Accept": "application/sparql-results+json" };
    const r = await fetch(url, { headers: h });
    if (!r.ok)
        throw new Error(`SPARQL HTTP ${r.status}`);
    return r.json();
}
async function titlesForAuthor(uri, limit = 250) {
    const q = `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT ?t WHERE { <${uri}> dblp:authored ?p . ?p dblp:title ?t . } LIMIT ${limit}`;
    const res = await runSparql(q);
    return res.results.bindings.map(b => norm(b.t.value));
}
async function countsForAuthor(uri) {
    const qTotal = `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT (COUNT(DISTINCT ?c) AS ?total) WHERE {
  ?p dblp:authoredBy <${uri}> . ?c dblp:cites ?p .
}`;
    const qSelf = `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT (COUNT(DISTINCT ?c) AS ?self) WHERE {
  ?p dblp:authoredBy <${uri}> . ?c dblp:cites ?p . ?c dblp:authoredBy <${uri}> .
}`;
    const [tot, self] = await Promise.all([runSparql(qTotal), runSparql(qSelf)]);
    const total = parseInt(tot.results.bindings[0]?.total?.value ?? "0", 10);
    const selfc = parseInt(self.results.bindings[0]?.self?.value ?? "0", 10);
    return { total, selfc, pct: total ? (selfc / total) * 100 : 0 };
}
// ─── Identify the best DBLP profile ─────────────────────────────
async function bestAuthorUri(name, scholarTitles) {
    const candidates = await searchAuthor(name);
    if (!candidates.length)
        return null;
    const scholarNorm = scholarTitles.map(norm);
    let bestUri = null, bestScore = 0;
    for (const c of candidates) {
        const sim = jaroWinkler(name.toLowerCase(), c.fullName.toLowerCase());
        if (sim < DBLP_HEURISTIC_MIN_NAME_SIMILARITY)
            continue;
        const uri = pidToUri(c.pid);
        const dblpTitles = await titlesForAuthor(uri);
        const overlap = scholarNorm.filter(t => dblpTitles.includes(t)).length;
        if (overlap < DBLP_HEURISTIC_MIN_OVERLAP_COUNT)
            continue;
        const score = overlap + sim * 2;
        if (score > bestScore) {
            bestScore = score;
            bestUri = uri;
        }
    }
    return bestUri;
}
// ─── Message listener ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((req, _snd, cb) => {
    if (req.action !== "processAuthor")
        return;
    (async () => {
        try {
            const uri = await bestAuthorUri(req.authorName, req.publicationTitles);
            if (!uri) {
                cb({ status: "error", message: "No matching DBLP profile." });
                return;
            }
            const { total, selfc, pct } = await countsForAuthor(uri);
            cb({ status: "success", totalCitations: total, selfCitations: selfc, percentage: pct });
        }
        catch (e) {
            cb({ status: "error", message: String(e) });
        }
    })();
    return true; // keep the channel open for the async reply
});
