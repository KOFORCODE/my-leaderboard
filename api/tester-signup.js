// /api/tester-signup.js
// Vercel Serverless Function — ระบบสมัคร Tester
// เงื่อนไข: Tier สูงสุด (นับทุกโหมด) ต้องเป็น C+ ขึ้นไป
// GET                 → สถานะการรับสมัคร + จำนวนผู้สมัคร
// GET ?uid=<uid>      → ตรวจ UID: ชื่อ, Tier สูงสุด, สมัครได้หรือไม่
// POST {uid}          → ส่งใบสมัคร (ตรวจสิทธิ์ซ้ำฝั่ง server เสมอ)
// เก็บในตาราง event_signups ด้วย event_key = 'tester' จึงไม่ต้องสร้างตารางใหม่
// ใช้ SUPABASE_SECRET_KEY (อ่าน/เขียนตารางได้โดยไม่ผ่าน RLS)

import { clientIp } from './_login-limit.js';
import { appendSignupToSheet } from './_sheet.js';

const TIERS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
const EVENT_KEY = 'tester'; // ต้องตรงกับ event_key ในตาราง event_signups
const MIN_TIER = 'C+'; // เงื่อนไขคงที่: C+ ขึ้นไป
const TITLE = 'สมัคร Tester';
const DESCRIPTION = `รับสมัครผู้เล่นที่มีอันดับ ${MIN_TIER} ขึ้นไปมาช่วยทดสอบระบบ ทีมงานจะติดต่อกลับผ่าน Discord`;

// จำกัดความถี่แยกตามชนิดคำขอ (เหมือน /api/event-signup)
const LIMIT_MS = { lookup: 1000, post: 2000 };
const lastByKind = { lookup: new Map(), post: new Map() };
function tooFast(kind, ip) {
  const m = lastByKind[kind];
  const now = Date.now();
  if (m.size > 5000) {
    const cutoff = now - LIMIT_MS[kind];
    for (const [k, v] of m) if (v < cutoff) m.delete(k);
    if (m.size > 5000) m.clear();
  }
  const last = m.get(ip);
  if (last && now - last < LIMIT_MS[kind]) return true;
  m.set(ip, now);
  return false;
}

// ตรวจผู้เล่นจาก UID: ข้อมูลผู้เล่น, Tier สูงสุด (ทุกโหมด) และสถานะสมัคร
async function inspectUid(sb, uid) {
  const pr = await sb(`players?uid=eq.${encodeURIComponent(uid)}&select=id,name,uid&limit=1`);
  if (!pr.ok) return { error: 'เชื่อมต่อฐานข้อมูลไม่ได้', status: 502 };
  const player = (await pr.json())[0];
  if (!player) return { error: 'ไม่พบ UID นี้ในเว็บไซต์ ตรวจ UID อีกครั้ง', status: 404 };

  const tr = await sb(`player_tiers?player_id=eq.${encodeURIComponent(player.id)}&select=tier_type`);
  // ถ้าอ่าน Tier ไม่ได้ ต้องแจ้ง error ไม่ใช่ทำเป็นว่าไม่มีอันดับ
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
    qualifies: best !== -1 && best <= TIERS.indexOf(MIN_TIER),
    signed,
  };
}

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

  const ip = clientIp(req);

  try {
    if (req.method === 'GET') {
      const uid = String(req.query?.uid ?? '').trim();

      // ตรวจ UID (preview ก่อนกดสมัคร)
      if (uid) {
        if (!/^\d{5,20}$/.test(uid)) return res.status(400).json({ error: 'UID ต้องเป็นตัวเลข 5 ถึง 20 หลัก' });
        if (tooFast('lookup', ip)) return res.status(429).json({ error: 'ตรวจถี่เกินไป รอสักครู่' });
        const r = await inspectUid(sb, uid);
        if (r.error) return res.status(r.status).json({ error: r.error });
        return res.status(200).json({
          name: r.player.name,
          uid: String(r.player.uid),
          tier: r.tier,
          qualifies: r.qualifies,
          signed: r.signed,
          minTier: MIN_TIER,
        });
      }

      // สถานะการรับสมัคร
      const r = await sb(`event_signups?event_key=eq.${encodeURIComponent(EVENT_KEY)}&select=id`);
      const rows = r.ok ? await r.json() : [];
      return res.status(200).json({
        title: TITLE,
        description: DESCRIPTION,
        open: true,
        minTier: MIN_TIER,
        mode: null,
        count: rows.length,
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (tooFast('post', ip)) return res.status(429).json({ error: 'ส่งถี่เกินไป รอสักครู่' });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const uid = String(body?.uid ?? '').trim();
    if (!/^\d{5,20}$/.test(uid)) return res.status(400).json({ error: 'UID ต้องเป็นตัวเลข 5 ถึง 20 หลัก' });

    // ชื่อ Discord ไว้ให้ทีมงานติดต่อกลับ
    const discord = String(body?.discord ?? '').trim();
    if (discord.length < 2 || discord.length > 64 || /[\u0000-\u001f\u007f]/.test(discord)) {
      return res.status(400).json({ error: 'ใส่ชื่อ Discord 2–64 ตัวอักษร' });
    }

    const r = await inspectUid(sb, uid);
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (r.signed) return res.status(409).json({ error: 'UID นี้สมัคร Tester ไปแล้ว' });
    if (!r.qualifies) return res.status(403).json({ error: `ต้องมีอันดับ ${MIN_TIER} ขึ้นไปจึงจะสมัครได้` });

    const ins = await sb('event_signups', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        event_key: EVENT_KEY,
        player_id: String(r.player.id),
        uid: String(r.player.uid),
        name: r.player.name,
        discord,
      }),
    });
    if (ins.status === 409) return res.status(409).json({ error: 'UID นี้สมัคร Tester ไปแล้ว' });
    if (!ins.ok) return res.status(502).json({ error: 'บันทึกการสมัครไม่สำเร็จ (อย่าลืมรัน sql/event_signups.sql เพื่อเพิ่มคอลัมน์ discord)' });

    // สำรองข้อมูลลง Google Sheet (ถ้าตั้ง SHEET_WEBHOOK_URL ไว้) — พลาดแล้วไม่ทำให้สมัครล้มเหลว
    await appendSignupToSheet({
      type: 'tester',
      name: r.player.name,
      uid: String(r.player.uid),
      tier: r.tier,
      discord,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true, name: r.player.name, uid: String(r.player.uid), tier: r.tier });
  } catch (e) {
    return res.status(502).json({ error: 'เชื่อมต่อฐานข้อมูลไม่ได้' });
  }
}
