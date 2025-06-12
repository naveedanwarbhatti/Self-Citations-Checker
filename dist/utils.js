// src/utils.ts
/**
 * Normalise an author or publication string for fuzzy matching.
 * Converts to lowercase, strips non-alphanumerics and collapses whitespace.
 */
export function sanitizeAuthorName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Compute the Jaro-Winkler similarity between two strings.
 * Returns a score between 0 and 1 where 1 means exact match.
 * Implementation is intentionally lightweight with no external dependencies.
 */
export function jaroWinkler(a, b) {
    if (a === b)
        return 1;
    const maxDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const matchA = [];
    const matchB = [];
    let matches = 0;
    for (let i = 0; i < a.length; i++) {
        const start = Math.max(0, i - maxDist);
        const end = Math.min(i + maxDist + 1, b.length);
        for (let j = start; j < end; j++) {
            if (!matchB[j] && a[i] === b[j]) {
                matchA[i] = matchB[j] = true;
                matches++;
                break;
            }
        }
    }
    if (!matches)
        return 0;
    let t = 0;
    let k = 0;
    for (let i = 0; i < a.length; i++) {
        if (matchA[i]) {
            while (!matchB[k])
                k++;
            if (a[i] !== b[k])
                t++;
            k++;
        }
    }
    const m = matches;
    const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
    let l = 0;
    while (l < 4 && a[l] === b[l])
        l++;
    return jaro + l * 0.1 * (1 - jaro);
}
/** Extract the clean author name from Google Scholar profile text. */
export function getScholarAuthorName(raw) {
    return sanitizeAuthorName(raw.split("(")[0]);
}
/**
 * Create a small sample of publication titles, normalised for comparison.
 */
export function getScholarSamplePublications(titles, limit = 5) {
    return titles.slice(0, limit).map((t) => sanitizeAuthorName(t));
}
/** Extract a DBLP PID from a DBLP profile URL. */
export function extractPidFromDblpUrl(url) {
    const m = url.match(/\/pid\/([^/]+\/[^/.]+)/);
    return m ? m[1] : "";
}
