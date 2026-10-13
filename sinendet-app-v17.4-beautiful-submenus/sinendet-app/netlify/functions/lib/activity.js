// Shared helper for recording admin/public actions to a simple activity log.
// Lives in a subfolder (not directly in netlify/functions/) so Netlify does
// NOT turn it into its own callable endpoint — it's bundled into whichever
// function requires it (submissions.js, roster.js, activity.js).
const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const KEY = 'log.json';
const MAX_ENTRIES = 300; // keep the log bounded — this is a lightweight audit trail, not permanent storage

// entry: { action, subject?, recordId?, studentName?, by?, details? }
// `by` should be the admin username when the action required login, or
// omitted/'-' for actions anyone can do (uploads, adding a task/media).
// Logging is best-effort: a failure here must never break the real request.
async function recordActivity(entry) {
  try {
    const store = getStore('activity');
    const list = (await store.get(KEY, { type: 'json' })) || [];
    list.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry });
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
    await store.setJSON(KEY, list);
  } catch (err) {
    // swallow — logging is never allowed to fail the caller's real request
  }
}

module.exports = { recordActivity, KEY };
