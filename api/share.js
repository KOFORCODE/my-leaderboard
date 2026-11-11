// /api/share.js
// Vercel Serverless Function: คืน HTML ที่มี og:tags ของผู้เล่นคนเดียว
// เรียกเฉพาะตอนที่ crawler ของแอปแชท (Discord, IG, LINE ฯลฯ) มาขอพรีวิวลิงก์ ?p=<uid>
// (ดู rewrite ใน vercel.json) คนทั่วไปที่เปิดลิงก์จะได้หน้า index.html ปกติ
// ใช้ anon key เดียวกับหน้าเว็บ (เป็นค่าสาธารณะอยู่แล้ว) และอ่านเฉพาะตารางที่หน้าเว็บอ่านอยู่แล้ว

const SUPABASE_URL = 'https://qfdtnfhcdxucckxakrgu.supabase.co';
const SUPABASE_ANON = 'sb_publishable_XGA4PQ3GY1LpEmSSRTyONg_2ogqR06G';
const SITE = 'https://my-leaderboard-five.vercel.app';
const DEFAULT_IMAGE = 'https://i.postimg.cc/pX75NqQp/333407178686439927.jpg';
const TIER_SCORE = {'S':100,'A+':85,'A':75,'A-':65,'B+':54,'B':46,'B-':38,'C+':30,'C':25,'C-':20,'D+':16,'D':13,'D-':10,'F':0};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

function page({ title, description, image, url }) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(url)}">
</head>
<body><a href="${esc(url)}">${esc(title)}</a></body>
</html>`;
}

export default async function handler(req, res) {
  const uid = String(req.query.p || '');
  const pageUrl = `${SITE}/?p=${encodeURIComponent(uid)}`;
  const fallback = {
    title: 'AVEN TIER — Tier List',
    description: 'ดูอันดับแนวตั้งของผู้เล่น AVEN TIER',
    image: DEFAULT_IMAGE,
    url: SITE + '/',
  };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (!/^\d{1,20}$/.test(uid)) {
    return res.status(200).send(page(fallback));
  }

  try {
    const players = await sb(`players?uid=eq.${uid}&select=id,name,region,badge,avatar,uid&limit=1`);
    const p = players?.[0];
    if (!p) {
      return res.status(200).send(page(fallback));
    }

    const [modes, tiers] = await Promise.all([
      sb('modes?select=id,include_in_overall'),
      sb(`player_tiers?player_id=eq.${encodeURIComponent(p.id)}&select=mode_id,tier_type`),
    ]);
    const overallIds = new Set((modes || []).filter(m => m.include_in_overall).map(m => m.id));
    const points = (tiers || [])
      .filter(t => overallIds.has(t.mode_id))
      .reduce((sum, t) => sum + (TIER_SCORE[t.tier_type] || 0), 0);

    const parts = [`Overall ${points} pts`];
    if (p.badge) parts.push(p.badge);
    if (p.region) parts.push(p.region);

    const image = /^https:\/\//i.test(String(p.avatar || '')) ? p.avatar : DEFAULT_IMAGE;

    return res.status(200).send(page({
      title: `${p.name} · AVEN TIER`,
      description: `${parts.join(' · ')} | ดูอันดับและ Tier ของผู้เล่น AVEN TIER`,
      image,
      url: pageUrl,
    }));
  } catch (e) {
    // ดึงข้อมูลไม่ได้ก็ยังคืนหน้าปกติ ให้พรีวิวใช้ค่าเริ่มต้นแทนที่จะพัง
    return res.status(200).send(page({ ...fallback, url: pageUrl }));
  }
}
