const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');
const { recordActivity } = require('./lib/activity');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const KEY = 'complete-subjects.json';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expected = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'sinendet-default-secret-change-me-2026')
    .update(payloadB64)
    .digest('hex');
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    return !(payload.exp && Date.now() > payload.exp);
  } catch {
    return false;
  }
}

function json(statusCode, obj) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

// Which subjects admin has manually marked "complete" — this is a plain
// on/off flag admin sets themselves (not auto-computed from submissions),
// shown as a badge on the main menu's subject tiles. Whether a subject is
// actually fully covered is a judgment call only a person can make (e.g. a
// student who's exempt, or work handed in on paper) — so this never tries
// to infer "complete" from the roster/submissions data itself.
exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const store = getStore('settings');

  try {
    // ---- GET: list which subject ids are marked complete (public) ----
    if (event.httpMethod === 'GET') {
      const list = (await store.get(KEY, { type: 'json' })) || [];
      return json(200, list);
    }

    // ---- POST: set the full list of complete subject ids (admin only) ----
    // body: { subjectIds: ['core-maths', 'chemistry', ...] }
    if (event.httpMethod === 'POST') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const body = JSON.parse(event.body || '{}');
      const ids = Array.isArray(body.subjectIds)
        ? Array.from(new Set(body.subjectIds.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())))
        : [];
      await store.setJSON(KEY, ids);
      await recordActivity({ action: 'subject_status_update', by: 'admin', details: `${ids.length} subject(s) marked complete` });
      return json(200, ids);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
