const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}');
    // Falls back to a default admin login so the site works immediately after a
    // drag-and-drop deploy. Change these any time by setting ADMIN_USERNAME /
    // ADMIN_PASSWORD as environment variables in the Netlify dashboard —
    // env vars always win over these defaults.
    const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Sinendet@2026';

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Incorrect username or password' }) };
    }

    const payload = { sub: username, exp: Date.now() + 1000 * 60 * 60 * 8 }; // valid 8 hours
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'sinendet-default-secret-change-me-2026')
      .update(payloadB64)
      .digest('hex');

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ token: `${payloadB64}.${sig}` }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
