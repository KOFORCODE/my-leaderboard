// /api/event-signup.js
// Vercel Serverless Function — ระบบสมัคร Event
// GET                 → สถานะ event (ชื่อ, เงื่อนไข, จำนวนผู้สมัคร)
// GET ?uid=<uid>      → ตรวจ UID: ชื่อ, Tier สูงสุด, สมัครได้หรือไม่
// POST {uid}          → สมัคร (ตรวจสิทธิ์ซ้ำฝั่ง server เสมอ)
// ค่า event (ชื่อ, เปิด/ปิด, Tier ขั้นต่ำ ฯลฯ) อ่านจากตาราง event_config ซึ่งแก้ได้ที่หน้า admin
// ใช้ SUPABASE_SECRET_KEY (อ่าน/เขียนตารางได้โดยไม่ผ่าน RLS)

const TIERS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
const EVENT_KEY = 'main'; 


const DEFAULT_CONFIG = {
  title: 'Comboo 500 Event',
  description: 'สมัครเข้าร่วม Event ของ Comboo 500 เฉพาะผู้เล่นที่มีอันดับในเว็บ',
  is_open: true,
  min_tier: 'D+',
  mode_name: null,
  closes_at: null,
};

const lastRequestByIp = new Map();
const RATE_LIMIT_MS = 2000;

// อ่านค่า event จากฐานข้อมูล แล้วแปลงเป็นรูปแบบที่ใช้จริง
async function getConfig(sb) {
  let row = null;
  try {
    const r = await sb('event_config?id=eq.1&select=*&limit=1');
    if (r.ok) row = (await r.json())[0] || null;
  } catch {
    row = null;
  }
  const c = { ...DEFAULT_CONFIG, ...(row || {}) };
  const pastClose = c.closes_at && Date.now() >= Date.parse(c.closes_at);
  return {
    title: c.title,
    description: c.description,
    minTier: TIERS.includes(c.min_tier) ? c.min_tier : DEFAULT_CONFIG.min_tier,
    modeName: c.mode_name || null,
    open: Boolean(c.is_open) && !pastClose,
  };
}

// ตรวจผู้เล่นจาก UID: ข้อมูลผู้เล่น, Tier สูงสุด (ในขอบเขตโหมดที่ตั้งไว้) และสถานะสมัคร
async function inspectUid(sb, uid, cfg) {
  const pr = await sb(`players?uid=eq.${encodeURIComponent(uid)}&select=id,name,uid&limit=1`);
  if (!pr.ok) return { error: 'เชื่อมต่อฐานข้อมูลไม่ได้', status: 502 };
  const player = (await pr.json())[0];
  if (!player) return { error: 'ไม่พบ UID นี้ในเว็บไซต์ ตรวจ UID อีกครั้ง', status: 404 };

  let modeFilter = '';
  if (cfg.modeName) {
    const mr = await sb(`modes?name=eq.${encodeURIComponent(cfg.modeName)}&select=id&limit=1`);
    const mode = mr.ok ? (await mr.json())[0] : null;
    if (!mode) return { error: `ไม่พบโหมด "${cfg.modeName}" ในฐานข้อมูล`, status: 500 };
    modeFilter = `&mode_id=eq.${encodeURIComponent(mode.id)}`;
  }

  const tr = await sb(`player_tiers?player_id=eq.${encodeURIComponent(player.id)}&select=tier_type${modeFilter}`);
  // ถ้าอ่าน Tier ไม่ได้ ต้องแจ้ง error ไม่ใช่ทำเป็นว่าไม่มีอันดับ (จะทำให้คนที่มีอันดับถูกมองว่าไม่มี)
  if (!tr.ok) return { error: 'อ่านอันดับไม่สำเร็จ ลองใหม่', status: 502 };
  const tiers = await tr.json();
  let best = -1;
  for (const t of tiers) {
    const i = TIERS.indexOf(t.tier_type);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }

  const sr = await sb(`event_signups?event_key=eq.${encodeURIComponent(EVENT_KEY)}&player_id=eq.${encodeURIComponent(player.id)}&select=id&limit=1`);
  const signed = sr.ok ? (await sr.json()).length > 0 : false;

  return {
    player,
    tier: best === -1 ? null : TIERS[best],
    qualifies: best !== -1 && best <= TIERS.indexOf(cfg.minTier),
    signed,
  };
}

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'มึงลืมตั้งค่า key แหละมั้ง' });
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

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const last = lastRequestByIp.get(ip);
  if (last && now - last < RATE_LIMIT_MS) {
    return res.status(429).json({ error: 'ส่งถี่เกินไป รอสักครู่' });
  }
  lastRequestByIp.set(ip, now);

  try {
    const cfg = await getConfig(sb);

    if (req.method === 'GET') {
      const uid = String(req.query?.uid ?? '').trim();

      // ตรวจ UID (preview ก่อนกดสมัคร)
      if (uid) {
        if (!/^\d{5,20}$/.test(uid)) return res.status(400).json({ error: 'UID ต้องเป็นตัวเลข 5 ถึง 20 หลัก' });
        const r = await inspectUid(sb, uid, cfg);
        if (r.error) return res.status(r.status).json({ error: r.error });
        return res.status(200).json({
          name: r.player.name,
          uid: String(r.player.uid),
          tier: r.tier,
          qualifies: r.qualifies,
          signed: r.signed,
          minTier: cfg.minTier,
        });
      }

      // สถานะ event
      const r = await sb(`event_signups?event_key=eq.${encodeURIComponent(EVENT_KEY)}&select=id`);
      const rows = r.ok ? await r.json() : [];
      return res.status(200).json({
        title: cfg.title,
        description: cfg.description,
        open: cfg.open,
        minTier: cfg.minTier,
        mode: cfg.modeName,
        count: rows.length,
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!cfg.open) return res.status(403).json({ error: 'ปิดรับสมัครแล้ว' });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const uid = String(body?.uid ?? '').trim();
    if (!/^\d{5,20}$/.test(uid)) return res.status(400).json({ error: 'UID ต้องเป็นตัวเลข 5 ถึง 20 หลัก' });

    const r = await inspectUid(sb, uid, cfg);
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (r.signed) return res.status(409).json({ error: 'UID นี้สมัครไปแล้ว' });
    if (!r.qualifies) return res.status(403).json({ error: `ต้องมีอันดับ ${cfg.minTier} ขึ้นไปจึงจะสมัครได้` });

    const ins = await sb('event_signups', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        event_key: EVENT_KEY,
        player_id: String(r.player.id),
        uid: String(r.player.uid),
        name: r.player.name,
      }),
    });
    if (ins.status === 409) return res.status(409).json({ error: 'UID นี้สมัครไปแล้ว' });
    if (!ins.ok) return res.status(502).json({ error: 'บันทึกการสมัครไม่สำเร็จ' });

    return res.status(200).json({ ok: true, name: r.player.name, uid: String(r.player.uid), tier: r.tier });
  } catch (e) {
    return res.status(502).json({ error: 'เชื่อมต่อฐานข้อมูลไม่ได้: ' + e.message });
  }
}
