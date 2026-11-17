import { createHash } from 'node:crypto';
import { clientIp } from './_login-limit.js';
import { resolveBracket } from './_bracket.js';

// กัน spam โหวต (unique constraint กันโหวตซ้ำอยู่แล้ว แต่ยังยิงถี่ได้)
const lastVoteAt = new Map();
const VOTE_LIMIT_MS = 1500;

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

  // hash ของ IP + secret: ใช้แยกคนโหวตโดยไม่เก็บ IP ตรงๆ
  const voterHash = createHash('sha256').update(`${clientIp(req)}|${SUPABASE_SECRET_KEY}`).digest('hex');

  async function loadBracket() {
    const [mr, vr, cr] = await Promise.all([
      sb('event_bracket?select=id,round,a_uid,b_uid,winner_uid&order=id'),
      sb('event_votes?select=match_id,choice,voter_hash'),
      sb('event_config?id=eq.1&select=bracket_visible'),
    ]);
    if (!mr.ok || !vr.ok) return null;
    const cfg = cr.ok ? (await cr.json())[0] : null;
    return { rows: await mr.json(), votes: await vr.json(), visible: cfg?.bracket_visible === true };
  }

  try {
    if (req.method === 'GET') {
      const data = await loadBracket();
      if (!data) return res.status(502).json({ error: 'โหลดสายการแข่งขันไม่สำเร็จ' });
      const matches = resolveBracket(data.rows).map((m) => {
        const mine = data.votes.filter((v) => v.match_id === m.id);
        const a = mine.filter((v) => v.choice === 'a').length;
        const b = mine.filter((v) => v.choice === 'b').length;
        const my = mine.find((v) => v.voter_hash === voterHash);
        return { ...m, votes: { a, b }, myChoice: my ? my.choice : null };
      });
      return res.status(200).json({ visible: data.visible, matches });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = null; }
      }
      const id = Number(body?.id);
      const choice = body?.choice;
      if (!Number.isInteger(id) || id < 1 || id > 7 || (choice !== 'a' && choice !== 'b')) {
        return res.status(400).json({ error: 'ข้อมูลโหวตไม่ถูกต้อง' });
      }

      const now = Date.now();
      if (lastVoteAt.size > 5000) {
        for (const [k, v] of lastVoteAt) if (now - v > VOTE_LIMIT_MS) lastVoteAt.delete(k);
        if (lastVoteAt.size > 5000) lastVoteAt.clear();
      }
      const ip = clientIp(req);
      const last = lastVoteAt.get(ip);
      if (last && now - last < VOTE_LIMIT_MS) return res.status(429).json({ error: 'โหวตถี่เกินไป รอสักครู่' });
      lastVoteAt.set(ip, now);

      const data = await loadBracket();
      if (!data) return res.status(502).json({ error: 'โหลดสายการแข่งขันไม่สำเร็จ' });
      if (!data.visible) return res.status(403).json({ error: 'ยังไม่เปิดให้โหวต' });
      const m = resolveBracket(data.rows).find((x) => x.id === id);
      if (!m || !m.a || !m.b) return res.status(400).json({ error: 'คู่นี้ยังไม่พร้อมให้โหวต' });
      if (m.winner) return res.status(400).json({ error: 'คู่นี้จบแล้ว' });

      const ir = await sb('event_votes', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ match_id: id, voter_hash: voterHash, choice }),
      });
      if (ir.status === 409) return res.status(409).json({ error: 'คุณโหวตคู่นี้ไปแล้ว' });
      if (!ir.ok) return res.status(502).json({ error: 'บันทึกโหวตไม่สำเร็จ' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ' });
  }
}
