const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');
const { recordActivity } = require('./lib/activity');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

      // Dedupe by assessment no. when one is given — that's the actual unique
      // identifier for a student, since two different learners can share the
      // same name. Only fall back to matching by name when neither entry has
      // an assessment no. at all. This means re-adding the same person (same
      // assessment no.) updates their name, while "John Kiprop, A001" and
      // "John Kiprop, A002" are correctly kept as two separate students.
      const existing = (await store.get(KEY, { type: 'json' })) || [];
      const keyFor = (s) => (s.assessmentNo ? 'no:' + s.assessmentNo.toLowerCase() : 'name:' + s.name.toLowerCase());
      const byKey = new Map(existing.map((s) => [keyFor(s), s]));
      for (const s of incoming) {
        const key = keyFor(s);
        if (byKey.has(key)) {
          // same identity (same assessment no., or same name when neither has one) — update in place
          const row = byKey.get(key);
          row.name = s.name || row.name;
          if (s.assessmentNo) row.assessmentNo = s.assessmentNo;
        } else {
          byKey.set(key, { id: crypto.randomUUID(), name: s.name, assessmentNo: s.assessmentNo });
        }
      }
      const merged = Array.from(byKey.values());
      merged.sort((a, b) => a.name.localeCompare(b.name));
      await store.setJSON(KEY, merged);
      await recordActivity({ action: 'roster_add', by: 'admin', details: `${incoming.length} student(s) added/updated` });
      return json(200, merged);
    }

    // ---- PATCH: set/clear a student's photo, and/or rename them (admin only) ----
    // body: { id, photoKey?, name?, assessmentNo? }
    //   - photoKey omitted/null clears the photo.
    //   - name/assessmentNo, when present in the body (even as ''), update that
    //     student's roster entry AND are propagated to every existing submission
    //     that referenced their OLD name/assessment no. — both individual
    //     records and group-member entries, across every subject — so a typo
    //     fix or an updated assessment no. doesn't leave old work orphaned.
    // The photo itself is uploaded separately via /api/upload (same as any
    // other small file) — this just records which media key belongs to
    // which roster entry, and cleans up the old photo blob if replaced.
    if (event.httpMethod === 'PATCH') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const body = JSON.parse(event.body || '{}');
      const { id } = body;
      if (!id) return json(400, { error: 'id is required' });
      const existing = (await store.get(KEY, { type: 'json' })) || [];
      const student = existing.find((s) => s.id === id);
      if (!student) return json(404, { error: 'Student not found' });

      if ('photoKey' in body) {
        const { photoKey } = body;
        if (student.photoKey && student.photoKey !== photoKey) {
          const mediaStore = getStore('media');
          await mediaStore.delete(student.photoKey).catch(() => {});
        }
        student.photoKey = photoKey || null;
        await store.setJSON(KEY, existing);
        await recordActivity({ action: photoKey ? 'roster_photo_set' : 'roster_photo_clear', by: 'admin', studentName: student.name });
        return json(200, student);
      }

      if ('name' in body || 'assessmentNo' in body) {
        const oldName = student.name;
        const oldNo = student.assessmentNo || '';
        const newName = 'name' in body ? String(body.name || '').trim().slice(0, 120) : student.name;
        const newNo = 'assessmentNo' in body ? String(body.assessmentNo || '').trim().slice(0, 60) : student.assessmentNo;
        if (!newName) return json(400, { error: 'Name is required' });

        const nameChanged = newName !== oldName;
        const noChanged = newNo !== oldNo;
        student.name = newName;
        student.assessmentNo = newNo;
        await store.setJSON(KEY, existing);

        let updatedCount = 0;
        if (nameChanged || noChanged) {
          const norm = (s) => String(s || '').trim().toLowerCase();
          const matchesOld = (name, no) =>
            oldNo ? norm(no) === norm(oldNo) : norm(name) === norm(oldName) && !norm(no);

          const subStore = getStore('submissions');
          const { blobs } = await subStore.list({});
          for (const b of blobs) {
            const record = await subStore.get(b.key, { type: 'json' });
            if (!record) continue;
            let changed = false;
            if (record.workType === 'group' && Array.isArray(record.members)) {
              record.members.forEach((m) => {
                const mName = typeof m === 'string' ? m : m.name;
                const mNo = typeof m === 'string' ? '' : m.assessmentNo;
                if (matchesOld(mName, mNo)) {
                  if (typeof m === 'string') {
                    record.members[record.members.indexOf(m)] = { name: newName, assessmentNo: newNo };
                  } else {
                    m.name = newName;
                    m.assessmentNo = newNo;
                  }
                  changed = true;
                }
              });
            } else if (matchesOld(record.studentName, record.assessmentNo)) {
              record.studentName = newName;
              record.assessmentNo = newNo;
              changed = true;
            }
            if (changed) {
              await subStore.setJSON(b.key, record);
              updatedCount++;
            }
          }
        }

        await recordActivity({
          action: 'roster_edit',
          by: 'admin',
          studentName: newName,
          details: updatedCount ? `Renamed — updated ${updatedCount} submission(s)` : 'Renamed',
        });
        return json(200, { student, updatedSubmissions: updatedCount });
      }

      return json(400, { error: 'Nothing to update' });
    }

    // ---- DELETE: remove one student, or several at once (admin only) ----
    // Pass either ?id=<one> or ?ids=<comma,separated,list>.
    if (event.httpMethod === 'DELETE') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const { id, ids } = event.queryStringParameters || {};
      const idSet = new Set(
        ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : id ? [id] : []
      );
      if (!idSet.size) return json(400, { error: 'id or ids is required' });
      const existing = (await store.get(KEY, { type: 'json' })) || [];
      // Clean up any photos belonging to the students being removed.
      const mediaStore = getStore('media');
      for (const s of existing) {
        if (idSet.has(s.id) && s.photoKey) await mediaStore.delete(s.photoKey).catch(() => {});
      }
      const filtered = existing.filter((s) => !idSet.has(s.id));
      await store.setJSON(KEY, filtered);
      await recordActivity({ action: 'roster_delete', by: 'admin', details: `${idSet.size} student(s) removed` });
      return json(200, filtered);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
