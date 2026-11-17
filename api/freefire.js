// /api/freefire.js
// Vercel Serverless Function — proxy คำขอค้นหาผู้เล่น Free Fire
// ใช้ FREEFIRE_API_KEY จาก Environment Variable เท่านั้น ไม่ปรากฏในโค้ด client
// รับทั้งรหัส ADMIN_PW และ TESTER_PW (การค้นหาไม่ได้เขียนข้อมูลลงฐานข้อมูล)

import { timingSafeEqual, createHash } from 'node:crypto';
import { isLocked, recordFail } from './_login-limit.js';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// rate limit แบบง่าย: กัน UID เดิมถูกยิงถี่เกินไปภายใน function instance เดียวกัน
// (อยู่ใน memory ชั่วคราว รีเซ็ตเมื่อ instance ถูกสร้างใหม่ - เป็นเกราะชั้นที่ 2 ต่อจาก cache ฝั่ง client)
const lastRequestByUid = new Map();
const RATE_LIMIT_MS = 3000; // ห้ามยิง UID เดิมซ้ำภายใน 3 วินาที

export default async function handler(req, res) {
  const ADMIN_PW = process.env.ADMIN_PW;
  const TESTER_PW = process.env.TESTER_PW; // ไม่บังคับ
  const FREEFIRE_API_KEY = process.env.FREEFIRE_API_KEY;
  const FREEFIRE_API_BASE = 'https://developers.freefirecommunity.com/api/v1';

  if (!ADMIN_PW || !FREEFIRE_API_KEY) {
    return res.status(500).json({
      error: 'ยังไม่ได้ตั้งค่า Environment Variables (ADMIN_PW / FREEFIRE_API_KEY) ใน Vercel',
    });
  }

  // ต้อง login เป็นแอดมินหรือ tester ก่อนถึงจะเรียก API นี้ได้ (กันคนนอกยิงมาใช้โควตาคีย์ฟรี)
  if (isLocked(req)) {
    return res.status(429).json({ error: 'ลองรหัสผิดหลายครั้ง รอ 15 นาทีแล้วลองใหม่' });
  }
  const pw = req.headers['x-admin-pw'];
  const ok = safeEqual(pw, ADMIN_PW) || (TESTER_PW && safeEqual(pw, TESTER_PW));
  if (!ok) {
    recordFail(req);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { region, uid } = req.query;
  if (!region || !uid) {
    return res.status(400).json({ error: 'Missing region or uid' });
  }
  if (!/^\d{5,15}$/.test(String(uid)) || !/^[A-Za-z0-9_-]{1,20}$/.test(String(region))) {
    return res.status(400).json({ error: 'UID หรือ region ไม่ถูกต้อง' });
  }

  const now = Date.now();
  if (lastRequestByUid.size > 5000) {
    const cutoff = now - RATE_LIMIT_MS;
    for (const [k, v] of lastRequestByUid) if (v < cutoff) lastRequestByUid.delete(k);
    if (lastRequestByUid.size > 5000) lastRequestByUid.clear();
  }
  const last = lastRequestByUid.get(uid);
  if (last && now - last < RATE_LIMIT_MS) {
    return res.status(429).json({ error: 'ค้น UID นี้ถี่เกินไป รอสักครู่แล้วลองใหม่' });
  }
  lastRequestByUid.set(uid, now);

  const url = `${FREEFIRE_API_BASE}/info?region=${encodeURIComponent(region)}&uid=${encodeURIComponent(uid)}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(url, {
      headers: {
        'x-api-key': FREEFIRE_API_KEY,
        'User-Agent': 'AVENTIER-Leaderboard/1.0 (+https://my-leaderboard-five.vercel.app)',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(text || '{}');
  } catch (e) {
    return res.status(502).json({ error: e.name === 'AbortError' ? 'Free Fire API ตอบช้าเกินไป' : 'เชื่อมต่อ Free Fire API ไม่สำเร็จ' });
  }
}
