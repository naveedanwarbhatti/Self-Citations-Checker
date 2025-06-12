// src/dblpSelfCitation.ts

/**
 * Helper utilities for querying DBLP self-citation statistics.
 * The returned rate is between 0 and 1 (1 == all citations are self-citations).
 */

const DBLP_SPARQL_ENDPOINT = 'https://sparql.dblp.org/sparql';

interface SparqlBinding {
  [key: string]: { value: string; type: string };
}
interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

/** Execute a SPARQL query against DBLP and return the JSON result. */
async function executeSparqlQuery(query: string): Promise<SparqlResponse> {
  const url = `${DBLP_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&output=json`;
  const response = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }
  return (await response.json()) as SparqlResponse;
}

export interface SelfCitationStats {
  total: number;
  self: number;
  rate: number;
}

/**
 * Fetch self-citation statistics for a DBLP profile.
 * @param pid DBLP author PID such as `00/1`.
 */
export async function fetchSelfCitationStats(pid: string): Promise<SelfCitationStats> {
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

  const [totalResp, selfResp] = await Promise.all([
    executeSparqlQuery(totalQuery),
    executeSparqlQuery(selfQuery),
  ]);

  const total = parseInt(totalResp.results.bindings[0]?.total?.value ?? '0', 10);
  const self = parseInt(selfResp.results.bindings[0]?.self?.value ?? '0', 10);
  const rate = total === 0 ? 0 : self / total;
  return { total, self, rate };
}
