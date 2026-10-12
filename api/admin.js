// /api/admin.js
// Vercel Serverless Function — proxy คำขอจากหน้า admin.html ไปยัง Supabase
// โดยใช้ SUPABASE_SECRET_KEY ที่อ่านจาก Environment Variable เท่านั้น
// คีย์นี้จะไม่ปรากฏในโค้ดฝั่ง client หรือใน git repo เลย
//
// สิทธิ์:
//   ADMIN_PW  -> แอดมิน ทำได้ทุกอย่าง
//   TESTER_PW -> tester ดูได้ทั้งหมด และเพิ่มได้เฉพาะตาราง players / player_tiers
//                (แก้ไข ลบ หรือเพิ่มตารางอื่นไม่ได้) บังคับที่ฝั่งเซิร์ฟเวอร์

import { timingSafeEqual } from 'node:crypto';

const TESTER_POST_TABLES = ['players', 'player_tiers'];

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export default async function handler(req, res) {
  const ADMIN_PW = process.env.ADMIN_PW;
  const TESTER_PW = process.env.TESTER_PW; // ไม่บังคับ: ถ้าไม่ตั้งก็ไม่มีบัญชี tester
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (!ADMIN_PW || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({
      error: 'ยังไม่ได้ตั้งค่า Environment Variables (ADMIN_PW / SUPABASE_URL / SUPABASE_SECRET_KEY) ใน Vercel',
    });
  }

  // ตรวจรหัสจาก header ทุกครั้งที่เรียก แล้วกำหนด role
  const pw = req.headers['x-admin-pw'];
  let role = null;
  if (safeEqual(pw, ADMIN_PW)) role = 'admin';
  else if (TESTER_PW && safeEqual(pw, TESTER_PW)) role = 'tester';

  if (!role) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ให้ client รู้ว่าเป็น role อะไร (ใช้แสดง UI เท่านั้น ความปลอดภัยจริงอยู่ที่ด่านด้านล่าง)
  res.setHeader('x-role', role);

  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing path' });
  }

  const method = req.method;

  // tester: อ่านได้ทั้งหมด (GET) เพิ่มได้เฉพาะ players / player_tiers (POST)
  // แก้ไข (PUT/PATCH) หรือลบ (DELETE) ไม่ได้ และเพิ่มในตารางอื่นก็ไม่ได้
  if (role === 'tester' && method !== 'GET') {
    const table = String(path).split('?')[0];
    const canAdd = method === 'POST' && TESTER_POST_TABLES.includes(table);
    if (!canAdd) {
      return res.status(403).json({ error: 'บัญชี tester ดูข้อมูลได้ และเพิ่มผู้เล่น/Tier ได้เท่านั้น แก้ไขหรือลบไม่ได้' });
    }
  }

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
