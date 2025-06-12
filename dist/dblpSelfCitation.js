// src/dblpSelfCitation.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/**
 * Helper utilities for querying DBLP self-citation statistics.
 * The returned rate is between 0 and 1 (1 == all citations are self-citations).
 */
const DBLP_SPARQL_ENDPOINT = 'https://sparql.dblp.org/sparql';
/** Execute a SPARQL query against DBLP and return the JSON result. */
function executeSparqlQuery(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${DBLP_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&output=json`;
        const response = yield fetch(url, {
            headers: { Accept: 'application/sparql-results+json' },
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        return (yield response.json());
    });
}
/**
 * Fetch self-citation statistics for a DBLP profile.
 * @param pid DBLP author PID such as `00/1`.
 */
export function fetchSelfCitationStats(pid) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const authorUri = `https://dblp.org/pid/${pid}`;
        const totalQuery = `
    PREFIX dblp: <https://dblp.org/rdf/schema#>
    SELECT (COUNT(DISTINCT ?citing_paper) AS ?total) WHERE {
      BIND(<${authorUri}> AS ?author_uri)
      ?authored_paper dblp:authoredBy ?author_uri .
      ?citing_paper dblp:cites ?authored_paper .
    }`;
        const selfQuery = `
    PREFIX dblp: <https://dblp.org/rdf/schema#>
    SELECT (COUNT(DISTINCT ?citing_paper) AS ?self) WHERE {
      BIND(<${authorUri}> AS ?author_uri)
      ?authored_paper dblp:authoredBy ?author_uri .
      ?citing_paper dblp:cites ?authored_paper .
      ?citing_paper dblp:authoredBy ?author_uri .
    }`;
        const [totalResp, selfResp] = yield Promise.all([
            executeSparqlQuery(totalQuery),
            executeSparqlQuery(selfQuery),
        ]);
        const total = parseInt((_c = (_b = (_a = totalResp.results.bindings[0]) === null || _a === void 0 ? void 0 : _a.total) === null || _b === void 0 ? void 0 : _b.value) !== null && _c !== void 0 ? _c : '0', 10);
        const self = parseInt((_f = (_e = (_d = selfResp.results.bindings[0]) === null || _d === void 0 ? void 0 : _d.self) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : '0', 10);
        const rate = total === 0 ? 0 : self / total;
        return { total, self, rate };
    });
}
