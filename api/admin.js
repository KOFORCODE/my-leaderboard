// /api/admin.js
// Vercel Serverless Function — proxy คำขอจากหน้า admin.html ไปยัง Supabase
// โดยใช้ SUPABASE_SECRET_KEY ที่อ่านจาก Environment Variable เท่านั้น
// คีย์นี้จะไม่ปรากฏในโค้ดฝั่ง client หรือใน git repo เลย

export default async function handler(req, res) {
  const ADMIN_PW = process.env.ADMIN_PW;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (!ADMIN_PW || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({
      error: 'ยังไม่ได้ตั้งค่า Environment Variables (ADMIN_PW / SUPABASE_URL / SUPABASE_SECRET_KEY) ใน Vercel',
    });
  }

  // ตรวจรหัสแอดมินจาก header ทุกครั้งที่เรียก — รหัสนี้ไม่ถูกเก็บไว้ในโค้ด client
  const pw = req.headers['x-admin-pw'];
  if (!pw || pw !== ADMIN_PW) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing path' });
  }

  const method = req.method;
  const url = `${SUPABASE_URL}/rest/v1/${path}`;

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
  };

  const options = { method, headers };
  if (method !== 'GET' && method !== 'DELETE' && req.body) {
    options.body =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  try {
    const r = await fetch(url, options);
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(text || '{}');
  } catch (e) {
    return res.status(502).json({ error: 'Supabase request failed: ' + e.message });
  }
}
