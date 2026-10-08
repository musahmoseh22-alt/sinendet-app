const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

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

function normalizeMembers(members) {
  if (!Array.isArray(members)) return [];
  return members
    .map((m) =>
      typeof m === 'string'
        ? { name: m.trim().slice(0, 120), assessmentNo: '' }
        : {
            name: String((m && m.name) || '').trim().slice(0, 120),
            assessmentNo: String((m && m.assessmentNo) || '').trim().slice(0, 60),
          }
    )
    .filter((m) => m.name !== '');
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((t) => ({
      label: (t && t.label ? String(t.label) : '').slice(0, 120),
      marks: t && t.marks !== '' && t.marks !== null && t.marks !== undefined && !isNaN(Number(t.marks)) ? Number(t.marks) : null,
    }))
    .filter((t) => t.label !== '' || t.marks !== null);
}

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const store = getStore('submissions');
  const mediaStore = getStore('media');
  const params = event.queryStringParameters || {};

  try {
    // ---- GET: list submissions for a subject ----
    if (event.httpMethod === 'GET') {
      const subject = params.subject;
      if (!subject) return json(400, { error: 'subject is required' });
      const { blobs } = await store.list({ prefix: `${subject}/` });
      const items = [];
      for (const b of blobs) {
        const data = await store.get(b.key, { type: 'json' });
        if (data) items.push(data);
      }
      items.sort((a, b) => b.createdAt - a.createdAt);
      return json(200, items);
    }

    // ---- POST: create a new submission (any user, no login needed) ----
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { id: clientId, subject, studentName, assessmentNo, marks, tasks, workType, members, photoKeys, videoKey, audioKey } = body;
      if (!subject || !studentName || !assessmentNo) {
        return json(400, { error: 'subject, studentName and assessmentNo are required' });
      }
      const id = clientId || crypto.randomUUID();

      const cleanTasks = normalizeTasks(tasks);
      const totalMarks = cleanTasks.length
        ? cleanTasks.reduce((s, t) => s + (t.marks || 0), 0)
        : (marks === '' || marks === undefined || marks === null ? null : Number(marks));

      const record = {
        id,
        subject,
        studentName,
        assessmentNo,
        workType: workType === 'group' ? 'group' : 'individual',
        members: workType === 'group' ? normalizeMembers(members) : [],
        tasks: cleanTasks,
        marks: totalMarks,
        photoKeys: Array.isArray(photoKeys) ? photoKeys : [],
        videoKey: videoKey || null,
        audioKey: audioKey || null,
        createdAt: Date.now(),
      };
      await store.setJSON(`${subject}/${id}.json`, record);
      return json(200, record);
    }

    // ---- PUT: edit an existing submission (admin only) ----
    if (event.httpMethod === 'PUT') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const body = JSON.parse(event.body || '{}');
      const { id, subject, studentName, assessmentNo, marks, tasks, workType, members, photoKeys, videoKey, audioKey } = body;
      if (!id || !subject) return json(400, { error: 'id and subject are required' });

      const key = `${subject}/${id}.json`;
      const existing = await store.get(key, { type: 'json' });
      if (!existing) return json(404, { error: 'Submission not found' });

      if (studentName) existing.studentName = studentName;
      if (assessmentNo) existing.assessmentNo = assessmentNo;

      if (workType === 'group' || workType === 'individual') {
        existing.workType = workType;
        existing.members = workType === 'group' ? normalizeMembers(members) : [];
      }

      if (Array.isArray(tasks)) {
        const cleanTasks = normalizeTasks(tasks);
        existing.tasks = cleanTasks;
        existing.marks = cleanTasks.length
          ? cleanTasks.reduce((s, t) => s + (t.marks || 0), 0)
          : (marks === '' || marks === undefined || marks === null ? null : Number(marks));
      } else if (marks !== undefined) {
        existing.marks = marks === '' ? null : Number(marks);
      }

      // photoKeys / videoKey / audioKey are only sent by the frontend when
      // something actually changed (new upload or explicit removal) — the
      // frontend has already uploaded any new files via the /api/upload
      // edge function and just tells us the final desired key(s) here.
      if (Array.isArray(photoKeys)) {
        const oldSet = new Set(existing.photoKeys || []);
        const newSet = new Set(photoKeys);
        for (const k of oldSet) if (!newSet.has(k)) await mediaStore.delete(k);
        existing.photoKeys = photoKeys;
      }

      if (videoKey !== undefined) {
        if (existing.videoKey && existing.videoKey !== videoKey) await mediaStore.delete(existing.videoKey);
        existing.videoKey = videoKey || null;
      }

      if (audioKey !== undefined) {
        if (existing.audioKey && existing.audioKey !== audioKey) await mediaStore.delete(existing.audioKey);
        existing.audioKey = audioKey || null;
      }

      await store.setJSON(key, existing);
      return json(200, existing);
    }

    // ---- PATCH: add one more task, or one more photo/video/audio, to an
    // existing submission — no login needed, same "anyone can add" spirit as
    // the original upload. This only ever adds to what's there; it never
    // changes or removes anything (that stays admin-only, via PUT/DELETE).
    // The frontend sends exactly one of these per call:
    //   { label, marks }      — append a task
    //   { addPhotoKey }       — append one more photo (already uploaded via /api/upload)
    //   { setVideoKey }       — set the video, only if there isn't one yet
    //   { setAudioKey }       — set the audio, only if there isn't one yet
    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const { id, subject, label, marks, addPhotoKey, setVideoKey, setAudioKey } = body;
      if (!id || !subject) return json(400, { error: 'id and subject are required' });

      const key = `${subject}/${id}.json`;
      const existing = await store.get(key, { type: 'json' });
      if (!existing) return json(404, { error: 'Submission not found' });

      let changed = false;

      if (marks !== undefined) {
        const cleanLabel = (label ? String(label) : '').trim().slice(0, 120) || `Task ${(existing.tasks || []).length + 1}`;
        const cleanMarks = marks !== '' && marks !== null && !isNaN(Number(marks)) ? Number(marks) : null;
        if (cleanMarks === null) return json(400, { error: 'Enter the marks for the new task' });
        existing.tasks = Array.isArray(existing.tasks) ? existing.tasks : [];
        existing.tasks.push({ label: cleanLabel, marks: cleanMarks });
        existing.marks = existing.tasks.reduce((s, t) => s + (t.marks || 0), 0);
        changed = true;
      }

      if (addPhotoKey) {
        existing.photoKeys = Array.isArray(existing.photoKeys) ? existing.photoKeys : [];
        existing.photoKeys.push(String(addPhotoKey));
        changed = true;
      }

      if (setVideoKey) {
        if (existing.videoKey) {
          await mediaStore.delete(String(setVideoKey)); // discard the just-uploaded file, it won't be used
          return json(409, { error: 'This submission already has a video — an admin needs to remove it first before another can be added.' });
        }
        existing.videoKey = String(setVideoKey);
        changed = true;
      }

      if (setAudioKey) {
        if (existing.audioKey) {
          await mediaStore.delete(String(setAudioKey));
          return json(409, { error: 'This submission already has audio — an admin needs to remove it first before new audio can be added.' });
        }
        existing.audioKey = String(setAudioKey);
        changed = true;
      }

      if (!changed) return json(400, { error: 'Nothing to add' });

      await store.setJSON(key, existing);
      return json(200, existing);
    }

    // ---- DELETE: remove a submission, or just one photo/video/audio from
    // it (admin only, both ways) ----
    if (event.httpMethod === 'DELETE') {
      if (!verifyToken(event.headers.authorization || event.headers.Authorization)) {
        return json(401, { error: 'Admin login required' });
      }
      const { subject, id, mediaKey, mediaType } = params;
      if (!subject || !id) return json(400, { error: 'subject and id are required' });
      const key = `${subject}/${id}.json`;
      const existing = await store.get(key, { type: 'json' });

      // Delete just one media item — used by the admin media library
      if (mediaKey && mediaType) {
        if (!existing) return json(404, { error: 'Submission not found' });
        if (mediaType === 'photo') {
          existing.photoKeys = (existing.photoKeys || []).filter((k) => k !== mediaKey);
        } else if (mediaType === 'video' && existing.videoKey === mediaKey) {
          existing.videoKey = null;
        } else if (mediaType === 'audio' && existing.audioKey === mediaKey) {
          existing.audioKey = null;
        }
        await mediaStore.delete(mediaKey);
        await store.setJSON(key, existing);
        return json(200, existing);
      }

      // Delete the whole submission and everything attached to it
      if (existing) {
        for (const k of existing.photoKeys || []) await mediaStore.delete(k);
        if (existing.videoKey) await mediaStore.delete(existing.videoKey);
        if (existing.audioKey) await mediaStore.delete(existing.audioKey);
      }
      await store.delete(key);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
