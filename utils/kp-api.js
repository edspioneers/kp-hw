import { getSiteConfig } from './site-config.js';

// Fallback proxy endpoint, used only when the `site-config` sheet is
// unreachable (e.g. unit tests / Storybook). In the browser the effective
// endpoint comes from site-config's `lucidSearchAPI` key for the current env.
export const DEFAULT_PROXY_ENDPOINT = 'https://1394629-808magentadolphin-stage.adobeio-static.net/api/v1/web/example/kp-api';
export const KP_SEARCH_BASE = 'https://apims.kaiserpermanente.org/kp/care/api/sda/kp-search-api/v1/api/kporg/search/v1';

// Resolve the proxy endpoint for the current environment, falling back to the
// hardcoded default if site-config doesn't provide one.
async function getProxyEndpoint() {
  const cfg = await getSiteConfig();
  return cfg.lucidSearchAPI || DEFAULT_PROXY_ENDPOINT;
}

// Region of practice. Derived from the user's location; defaults to
// N. California (the region KP's sample calls use) when none is given.
export const DEFAULT_ROP = 'NCA';

export function zipToRop(zip) {
  const n = parseInt(zip, 10);
  if (Number.isNaN(n)) return DEFAULT_ROP;
  // NorCal ZIPs are roughly 94000–96199; SoCal 90000–93599.
  return n >= 94000 ? 'NCA' : 'SCA';
}

export function latToRop(lat) {
  // Rough CA split near 35.8°N.
  return lat >= 35.8 ? 'NCA' : 'SCA';
}

// Two sources now, depending on the call:
//  - FACET_SOURCE  → the topic (and facet) listing, list-show=0
//  - TOPIC_SOURCE  → a topic's results + facets + pagination, list-show=10
export const FACET_SOURCE = 'kp-health-classes';
export const TOPIC_SOURCE = 'kp-health-classes-topic';

// Builds the KP search URL (topic-first model — no distance/ZIP/geolocation).
// - The base binning-state carries just `health_topic==<label>` (empty for the
//   facet listing). Multi-word topics keep their literal spaces, as KP's own
//   calls do.
// - Each active sidebar filter is its OWN extra `binning-state` query param.
export function buildKpSearchUrl({
  source, rop = DEFAULT_ROP, topicLabel = '',
  listShow = 0, vstate = '', filterTokens = [],
}) {
  const params = [
    `v:sources=${source}`,
    'v:project=kp-classes-project',
    'query=',
    `rop=${rop}`,
    'user_zip=',
    `binning-state=${topicLabel ? `health_topic==${topicLabel}` : ''}`,
    'user_lat=',
    'user_lon=',
    'locale=en-us',
    'render.function=json-feed-display-document',
    'content-type=application-json',
    `render.list-show=${listShow}`,
  ];
  if (vstate) params.push(`v:state=${vstate}`);
  filterTokens.forEach((t) => params.push(`binning-state=${t}`));
  return `${KP_SEARCH_BASE}?${params.join('&')}`;
}

// Every KP Lucid Search call goes through the App Builder proxy. KP sends no
// CORS headers on any origin, so the browser can never reach it directly —
// there's no host (main, branch preview, or localhost) where a direct call works.
export async function callProxy(kpUrl, body) {
  const endpoint = await getProxyEndpoint();
  const payload = body ? { url: kpUrl, body } : { url: kpUrl };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`proxy request failed: ${res.status}`);
  return res.json();
}

const CONTENT_HUB_SQL = 'https://apims.kaiserpermanente.org/kp/care/api/kpd/csconsumptionapi/v1/sql';

// Fetches KP health articles from the Content Hub SQL API.
// tags: string[] — source cq:tag values OR'd to define the article pool
// topic: string — optional topic cq:tag AND'd to narrow the pool
// language: string — e.g. 'english', 'spanish'
// taxonomicID: string — content taxonomy ID
export async function fetchArticles({
  tags = [], topic = '', language = 'english', taxonomicID,
}) {
  const tagParams = tags.map((value, i) => ({ name: `@cqTagsOr0${i}`, value }));
  const whereTag = tagParams.map((p) => `CONTAINS(c.metadata["cq:tags"], ${p.name})`).join(' OR ');
  const topicClause = topic ? ' AND CONTAINS(c.metadata["cq:tags"], @topic)' : '';
  const query = `SELECT c.title, c.name, c.elements["headline"], c.elements["teaser"], c.elements["primaryImageOfPage"] FROM c WHERE (${whereTag})${topicClause} AND IS_DEFINED(c.elements.language.variations[@language]) AND c.metadata["taxonomicID"] = @taxonomicID ORDER BY c.elements.displayDate["value"] DESC`;
  const parameters = [
    ...tagParams,
    { name: '@language', value: language },
    { name: '@taxonomicID', value: taxonomicID },
  ];
  if (topic) parameters.push({ name: '@topic', value: topic });
  return callProxy(CONTENT_HUB_SQL, { query, parameters });
}

// Health-topic facets only — no topic in binning-state, list-show=0.
export async function fetchTopics({ rop = DEFAULT_ROP } = {}) {
  const data = await callProxy(buildKpSearchUrl({ source: FACET_SOURCE, rop, listShow: 0 }));
  const set = (data.binning?.['binning-set'] || []).find((s) => s['bs-id'] === 'health_topic');
  return (set?.bins || []).map((b) => ({
    label: b.label, token: b.token, count: Number(b.ndocs) || 0,
  }));
}

// Paginated results + facets + navigation for a topic, 10 per page.
export async function fetchResults({
  rop = DEFAULT_ROP, topicLabel, offset = 0, filterTokens = [],
}) {
  return callProxy(buildKpSearchUrl({
    source: TOPIC_SOURCE,
    rop,
    topicLabel,
    filterTokens,
    listShow: 10,
    vstate: `root|root-${offset}-10`,
  }));
}
