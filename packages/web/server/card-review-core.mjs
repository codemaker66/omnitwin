import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DESIGN_IDS = Object.freeze(['38', '43', '46', '35', '29', '32', '33', '21', '22', '15', '02', '01-v2', '05', 'nocturne', 'nocturne-2']);
export const BODY_LIMIT = 40_960;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const allowedIds = new Set(DESIGN_IDS);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class ReviewError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function invalid(message) { throw new ReviewError(400, 'VALIDATION_ERROR', message); }
function boundedString(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max) invalid(`${label} must be text of at most ${max} characters.`);
  const trimmed = value.trim();
  if (required && !trimmed) invalid(`${label} is required.`);
  return trimmed;
}

export function validateResponse(body) {
  if (!record(body)) invalid('A JSON object is required.');
  const keys = ['reviewerName', 'favourite', 'comments', 'generalComment', 'revision'];
  if (Object.keys(body).some(key => !keys.includes(key))) invalid('The response contains an unrecognised field.');
  const reviewerName = boundedString(body.reviewerName, 100, 'Your name', true);
  const favourite = body.favourite ?? null;
  if (favourite !== null && (typeof favourite !== 'string' || !allowedIds.has(favourite))) invalid('Choose one of the selected designs.');
  const sourceComments = body.comments ?? {};
  if (!record(sourceComments) || Object.keys(sourceComments).some(key => !allowedIds.has(key))) invalid('Comments must refer to a selected design.');
  const comments = {};
  for (const id of DESIGN_IDS) {
    if (own(sourceComments, id)) {
      const text = boundedString(sourceComments[id], 2000, `Comment on ${id}`);
      if (text) comments[id] = text;
    }
  }
  const generalComment = boundedString(body.generalComment ?? '', 2000, 'Overall comment');
  if (favourite === null && !generalComment && !Object.keys(comments).length) invalid('Select a favourite or add a comment before saving.');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision > 1_000_000) invalid('A valid response revision is required.');
  return { reviewerName, favourite, comments, generalComment, revision: body.revision };
}

export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
export function secretMatches(value, expected) {
  if (!TOKEN.test(value ?? '') || !TOKEN.test(expected ?? '')) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

function header(req, name) {
  const value = req.headers[name];
  return typeof value === 'string' ? value : '';
}

function authenticate(req) {
  const authorization = header(req, 'authorization');
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) throw new ReviewError(401, 'UNAUTHORIZED', 'This review session is missing. Please reload the page.');
  return match[1];
}

function checkOrigin(req, allowedOrigins) {
  const origin = header(req, 'origin');
  const fetchSite = header(req, 'sec-fetch-site');
  if ((origin && !allowedOrigins.has(origin)) || fetchSite === 'cross-site' || (req.method === 'POST' && !origin)) {
    throw new ReviewError(403, 'ORIGIN_NOT_ALLOWED', 'Please save your response from the review page.');
  }
}

export async function readBody(req) {
  const contentType = header(req, 'content-type').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ReviewError(415, 'CONTENT_TYPE', 'Send the response as JSON.');
  const declaredLength = header(req, 'content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > BODY_LIMIT)) {
    throw new ReviewError(413, 'BODY_TOO_LARGE', 'This response is too large. Please shorten your comments.');
  }
  // Vercel's lazy body helper can itself reject malformed JSON when accessed.
  let parsedBody;
  try { parsedBody = req.body; } catch { invalid('The response is not valid JSON.'); }
  // Vercel may have parsed the body already; the local adapter streams it.
  if (parsedBody !== undefined) {
    let bodyText;
    try { bodyText = typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody); }
    catch { invalid('The response is not valid JSON.'); }
    if (Buffer.byteLength(bodyText ?? '', 'utf8') > BODY_LIMIT) throw new ReviewError(413, 'BODY_TOO_LARGE', 'This response is too large.');
    try { return JSON.parse(bodyText); } catch { invalid('The response is not valid JSON.'); }
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > BODY_LIMIT) throw new ReviewError(413, 'BODY_TOO_LARGE', 'This response is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { invalid('The response is not valid JSON.'); }
}

export function createReviewHandler({ store, ownerToken, rateSecret, allowedOrigins, onError = () => {} }) {
  const origins = new Set(allowedOrigins);
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    try {
      if (!TOKEN.test(ownerToken ?? '') || !TOKEN.test(rateSecret ?? '')) throw new Error('Review service is not configured.');
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        throw new ReviewError(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
      }
      checkOrigin(req, origins);
      const token = authenticate(req);
      const isOwner = secretMatches(token, ownerToken);
      const view = new URL(req.url, 'https://venviewer.com').searchParams.get('view');
      if (view !== null && view !== 'all') invalid('Unknown review view.');
      if (view === 'all' && !isOwner) throw new ReviewError(403, 'FORBIDDEN', 'The owner link is required to see responses.');
      if (req.method === 'POST' && isOwner) throw new ReviewError(403, 'OWNER_READ_ONLY', 'The owner link is for reading responses. Use the selection page to leave a review.');
      const ip = header(req, 'x-forwarded-for').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
      // Only a one-way keyed digest reaches storage; raw IP addresses are never retained.
      const key = createHmac('sha256', rateSecret).update(`${req.method}:${ip}`).digest('hex');
      const limit = req.method === 'POST' ? 60 : 240;
      if (!await store.takeRateLimit(key, limit)) {
        res.setHeader('Retry-After', '3600');
        throw new ReviewError(429, 'RATE_LIMIT', 'Too many requests. Please try again later; your saved response is safe.');
      }
      if (req.method === 'GET') {
        if (view === 'all') return send(200, { responses: await store.listResponses(), updatedAt: new Date().toISOString() });
        if (isOwner) throw new ReviewError(400, 'OWNER_VIEW_REQUIRED', 'Open the results page to see all responses.');
        return send(200, { response: await store.getResponse(tokenHash(token)) });
      }
      const body = validateResponse(await readBody(req));
      const response = await store.saveResponse(tokenHash(token), body);
      if (!response) throw new ReviewError(409, 'STALE_RESPONSE', 'A newer response was saved in another tab. Reload your saved response before editing again.');
      return send(200, { response });
    } catch (error) {
      if (error instanceof ReviewError) return send(error.status, { error: error.message, code: error.code });
      onError(error);
      return send(503, { error: 'Your response could not be saved or loaded. Please try again; keep this page open.', code: 'SERVICE_UNAVAILABLE' });
    }
  };
}
