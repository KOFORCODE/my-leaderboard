// /api/freefire-public.js
// Vercel Serverless Function — endpoint สาธารณะสำหรับหน้าเว็บหลัก (index.html)
// ใช้ค้นหา "การ์ดชั่วคราว" ของผู้เล่นที่ยังไม่มีในฐานข้อมูล
// ไม่ต้อง login แอดมิน แต่จำกัดการเรียกเข้มงวดกว่า api/freefire.js (ของแอดมิน) มาก
// เพราะเปิดให้ใครก็เรียกได้ - กันไม่ให้โดนใช้โควตา FREEFIRE_API_KEY หมดจากการสแปม

const lastRequestByIp = new Map();
const lastRequestByUid = new Map();
const RATE_LIMIT_PER_IP_MS = 4000;   // 1 IP ห้ามยิงถี่กว่า 4 วินาที
const RATE_LIMIT_PER_UID_MS = 15000; // UID เดิมห้ามยิงถี่กว่า 15 วินาที (กันคนเปลี่ยน IP ยิง UID เดิมซ้ำ)

export default async function handler(req, res) {
  const FREEFIRE_API_KEY = process.env.FREEFIRE_API_KEY;
  const FREEFIRE_API_BASE = 'https://developers.freefirecommunity.com/api/v1';

  if (!FREEFIRE_API_KEY) {
    return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า FREEFIRE_API_KEY ใน Vercel' });
  }

  const { region, uid } = req.query;
  if (!region || !uid) {
    return res.status(400).json({ error: 'Missing region or uid' });
  }
  // uid ต้องเป็นตัวเลขเท่านั้น กันคนยิง payload แปลกๆ เข้ามา
  if (!/^\d{5,15}$/.test(uid)) {
    return res.status(400).json({ error: 'UID ไม่ถูกต้อง' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();

  const lastIp = lastRequestByIp.get(ip);
  if (lastIp && now - lastIp < RATE_LIMIT_PER_IP_MS) {
    return res.status(429).json({ error: 'ค้นหาถี่เกินไป รอสักครู่แล้วลองใหม่' });
  }
  const lastUid = lastRequestByUid.get(uid);
  if (lastUid && now - lastUid < RATE_LIMIT_PER_UID_MS) {
    return res.status(429).json({ error: 'UID นี้เพิ่งถูกค้นหาไปเมื่อกี้ รอสักครู่แล้วลองใหม่' });
  }
  lastRequestByIp.set(ip, now);
  lastRequestByUid.set(uid, now);

  const url = `${FREEFIRE_API_BASE}/info?region=${encodeURIComponent(region)}&uid=${encodeURIComponent(uid)}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, {
      headers: {
        'x-api-key': FREEFIRE_API_KEY,
        'User-Agent': 'Comboo500-Leaderboard/1.0 (+https://my-leaderboard-five.vercel.app)',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!r.ok) {
      return res.status(r.status).json({ error: `Free Fire API ${r.status}` });
    }

    const data = await r.json().catch(() => null);
    const info = data?.basicInfo || data?.basicinfo || data?.data?.basicInfo || data?.data?.basicinfo;
    const nickname = info?.nickname || info?.accountName || info?.name;

    if (!nickname) {
      return res.status(404).json({ error: 'ไม่พบผู้เล่น' });
    }

    // คืนกลับแค่ชื่อกับ UID เท่านั้น ไม่คืนข้อมูลอื่น (เลเวล, แรงค์เกม, กิลด์ ฯลฯ)
    return res.status(200).json({ nickname, uid });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Free Fire API ตอบช้าเกินไป' : e.message;
    return res.status(502).json({ error: msg });
  }
}
