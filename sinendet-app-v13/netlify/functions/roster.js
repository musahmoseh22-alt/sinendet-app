const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const KEY = 'students.json';

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

function cleanEntry(e) {
  const name = String((e && e.name) || '').trim().slice(0, 120);
  const assessmentNo = String((e && e.assessmentNo) || '').trim().slice(0, 60);
  return { name, assessmentNo };
}

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const store = getStore('roster');

  try {
    // ---- GET: list the student roster (public — teachers need this to pick from) ----
    if (event.httpMethod === 'GET') {
      const list = (await store.get(KEY, { type: 'json' })) || [];
      list.sort((a, b) => a.name.localeCompare(b.name));
      return json(200, list);
    }

    // ---- POST: add / bulk-add students (admin only) ----
    // body: { students: [{name, assessmentNo}, ...] }
    if (event.httpMethod === 'POST') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const body = JSON.parse(event.body || '{}');
      const incoming = Array.isArray(body.students) ? body.students.map(cleanEntry).filter((s) => s.name !== '') : [];
      if (!incoming.length) return json(400, { error: 'No students provided' });

      const existing = (await store.get(KEY, { type: 'json' })) || [];
      const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
      for (const s of incoming) {
        const key = s.name.toLowerCase();
        if (byName.has(key)) {
          // update assessment no. if a new one was supplied
          if (s.assessmentNo) byName.get(key).assessmentNo = s.assessmentNo;
        } else {
          byName.set(key, { id: crypto.randomUUID(), name: s.name, assessmentNo: s.assessmentNo });
        }
      }
      const merged = Array.from(byName.values());
      merged.sort((a, b) => a.name.localeCompare(b.name));
      await store.setJSON(KEY, merged);
      return json(200, merged);
    }

    // ---- DELETE: remove one student by id (admin only) ----
    if (event.httpMethod === 'DELETE') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const { id } = event.queryStringParameters || {};
      if (!id) return json(400, { error: 'id is required' });
      const existing = (await store.get(KEY, { type: 'json' })) || [];
      const filtered = existing.filter((s) => s.id !== id);
      await store.setJSON(KEY, filtered);
      return json(200, filtered);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
