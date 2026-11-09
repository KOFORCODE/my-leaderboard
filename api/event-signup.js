// /api/event-signup.js
// Vercel Serverless Function — รับสมัคร Event
// ตรวจสิทธิ์ฝั่ง server: ผู้เล่นต้องมีในเว็บ และมี Tier ตั้งแต่ MIN_TIER ขึ้นไป
// ใช้ SUPABASE_SECRET_KEY (เขียนตาราง event_signups ได้โดยไม่ผ่าน RLS)

const TIERS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

// ===== ตั้งค่า Event ตรงนี้ =====
const EVENT_KEY = 'main';   // ชื่อ event (ต้องตรงกับ event_key ในฐานข้อมูล)
const SIGNUP_OPEN = true;   // false = ปิดรับสมัคร
const MIN_TIER = 'D+';      // Tier ขั้นต่ำที่สมัครได้ (D+ ขึ้นไป = S ถึง D+)
const MODE_NAME = '';       // ชื่อโหมดที่ใช้ตัดสิน เช่น 'Clash Squad' · ว่างไว้ = Tier ในโหมดไหนก็ได้
// =================================

const MIN_INDEX = TIERS.indexOf(MIN_TIER);
const lastRequestByIp = new Map();
const RATE_LIMIT_MS = 4000; // 1 IP ยิงถี่กว่า 4 วินาทีไม่ได้

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SECRET_KEY ใน Vercel' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const sb = (path, opts = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

  // GET: สถานะ event สำหรับหน้าเว็บ
  if (req.method === 'GET') {
    try {
      const r = await sb(`event_signups?event_key=eq.${encodeURIComponent(EVENT_KEY)}&select=id`);
      const rows = r.ok ? await r.json() : [];
      return res.status(200).json({ open: SIGNUP_OPEN, minTier: MIN_TIER, count: rows.length });
    } catch (e) {
      return res.status(502).json({ error: 'เชื่อมต่อฐานข้อมูลไม่ได้' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SIGNUP_OPEN) {
    return res.status(403).json({ error: 'ปิดรับสมัครแล้ว' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const last = lastRequestByIp.get(ip);
  if (last && now - last < RATE_LIMIT_MS) {
    return res.status(429).json({ error: 'ส่งถี่เกินไป รอสักครู่แล้วลองใหม่' });
  }
  lastRequestByIp.set(ip, now);

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const uid = String(body?.uid ?? '').trim();
  if (!/^\d{5,20}$/.test(uid)) {
    return res.status(400).json({ error: 'UID ต้องเป็นตัวเลข 5–20 หลัก' });
  }

  try {
    // 1) หาผู้เล่นในเว็บจาก UID
    const pr = await sb(`players?uid=eq.${encodeURIComponent(uid)}&select=id,name,uid&limit=1`);
    if (!pr.ok) return res.status(502).json({ error: 'เชื่อมต่อฐานข้อมูลไม่ได้' });
    const player = (await pr.json())[0];
    if (!player) {
      return res.status(404).json({ error: 'ไม่พบ UID นี้ในเว็บไซต์ (ต้องมีอันดับในเว็บก่อนถึงจะสมัครได้)' });
    }

    // 2) ถ้าระบุโหมด ต้องหา mode_id ก่อน
    let modeFilter = '';
    if (MODE_NAME) {
      const mr = await sb(`modes?name=eq.${encodeURIComponent(MODE_NAME)}&select=id&limit=1`);
      const mode = mr.ok ? (await mr.json())[0] : null;
      if (!mode) return res.status(500).json({ error: `ไม่พบโหมด "${MODE_NAME}" ในฐานข้อมูล` });
      modeFilter = `&mode_id=eq.${encodeURIComponent(mode.id)}`;
    }

    // 3) ตรวจ Tier: ต้องมีอันดับตั้งแต่ MIN_TIER ขึ้นไป (index ใน TIERS น้อยกว่าหรือเท่ากับ)
    const tr = await sb(`player_tiers?player_id=eq.${encodeURIComponent(player.id)}&select=tier_type${modeFilter}`);
    const tiers = tr.ok ? await tr.json() : [];
    const qualifies = tiers.some((t) => {
      const i = TIERS.indexOf(t.tier_type);
      return i !== -1 && i <= MIN_INDEX;
    });
    if (!qualifies) {
      return res.status(403).json({ error: `ต้องมีอันดับ ${MIN_TIER} ขึ้นไปจึงจะสมัครได้` });
    }

    // 4) บันทึก (unique (event_key, player_id) กันสมัครซ้ำ)
    const ins = await sb('event_signups', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        event_key: EVENT_KEY,
        player_id: String(player.id),
        uid: String(player.uid),
        name: player.name,
      }),
    });
    if (ins.status === 409) {
      return res.status(409).json({ error: 'UID นี้สมัครไปแล้ว' });
    }
    if (!ins.ok) return res.status(502).json({ error: 'บันทึกการสมัครไม่สำเร็จ' });

    return res.status(200).json({ ok: true, name: player.name, uid: String(player.uid) });
  } catch (e) {
    return res.status(502).json({ error: 'เชื่อมต่อฐานข้อมูลไม่ได้: ' + e.message });
  }
}
