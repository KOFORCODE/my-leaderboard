// /api/admin.js
// Vercel Serverless Function — proxy คำขอจากหน้า admin.html ไปยัง Supabase
// โดยใช้ SUPABASE_SECRET_KEY ที่อ่านจาก Environment Variable เท่านั้น
// คีย์นี้จะไม่ปรากฏในโค้ดฝั่ง client หรือใน git repo เลย
//
// สิทธิ์:
//   ADMIN_PW  -> แอดมิน ทำได้ทุกอย่างกับ 4 ตารางที่หน้า admin ใช้
//   TESTER_PW -> tester ดูได้ทั้งหมด เพิ่มได้เฉพาะตาราง players / player_tiers
//                แก้ไขได้เฉพาะตาราง player_tiers (tier) ลบไม่ได้เลย
//                ตั้ง badge / รูปผู้เล่นไม่ได้
//                บังคับที่ฝั่งเซิร์ฟเวอร์
//
// ความปลอดภัยเพิ่มเติม (ทุก role):
//   - path ต้องเป็นชื่อตารางในรายการอนุญาตเท่านั้น (กัน ../ ไปยิง endpoint อื่นของ Supabase ด้วย secret key)
//   - PATCH / DELETE ต้องระบุแถวด้วย id=eq.<id> เสมอ (กันแก้/ลบทั้งตารางโดยไม่ตั้งใจ)
//   - ตรวจฟิลด์และค่าของข้อมูลที่เขียน (กันข้อความแปลกๆ / ลิงก์ javascript: เข้าฐานข้อมูล)

import { timingSafeEqual } from 'node:crypto';

const TIERS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
const REGIONS = [
  'TH', 'IND', 'BD', 'PK', 'SG', 'ID', 'VN', 'TW', 'BR', 'SAC',
  'US', 'NA', 'ME', 'RU', 'CIS', 'EUROPE', 'AS', 'EU',
];

// ตารางที่หน้า admin ใช้จริง + method ที่แต่ละ role เรียกได้
// ถ้าเพิ่มตารางใหม่ในอนาคต ต้องมาเพิ่มที่นี่ (และเพิ่มกฎใน FIELD_RULES ถ้าต้องเขียนข้อมูล)
const ACCESS = {
  admin: {
    modes: ['GET', 'POST', 'PATCH', 'DELETE'],
    players: ['GET', 'POST', 'PATCH', 'DELETE'],
    player_tiers: ['GET', 'POST', 'PATCH', 'DELETE'],
    site_settings: ['GET', 'PATCH'],
  },
  tester: {
    modes: ['GET'],
    players: ['GET', 'POST'],
    player_tiers: ['GET', 'POST', 'PATCH'],
    site_settings: ['GET'],
  },
};

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------- path ----------
// รับเฉพาะ "ชื่อตาราง" หรือ "ชื่อตาราง?query" ที่อยู่ในรายการอนุญาต
function parsePath(raw) {
  if (typeof raw !== 'string') return null; // กรณี ?path=a&path=b จะเป็น array
  if (raw.length === 0 || raw.length > 400) return null;
  // ห้ามอักขระควบคุม ช่องว่าง # \ และห้าม ".." (path traversal)
  if (/[\u0000-\u001f\u007f\s#\\]/.test(raw) || raw.includes('..')) return null;
  const q = raw.indexOf('?');
  const table = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? '' : raw.slice(q + 1);
  if (!Object.prototype.hasOwnProperty.call(ACCESS.admin, table)) return null;
  return { table, query };
}

// ---------- ตรวจข้อมูลที่เขียน ----------
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === undefined || v === null || v === '';
const isHttpUrl = (v) => typeof v === 'string' && v.length <= 500 && /^https?:\/\/[^\s<>"']+$/i.test(v);
const isId = (v) =>
  (Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v));

const URL_MSG = 'URL ต้องขึ้นต้นด้วย http:// หรือ https:// และไม่เกิน 500 ตัวอักษร';

// แต่ละกฎคืนค่า null ถ้าผ่าน หรือข้อความ error ถ้าไม่ผ่าน
const FIELD_RULES = {
  players: {
    name: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.length <= 100 ? null : 'ชื่อผู้เล่นต้องยาว 1–100 ตัวอักษร'),
    uid: (v) => (isEmpty(v) || /^\d{1,20}$/.test(String(v)) ? null : 'UID ต้องเป็นตัวเลขไม่เกิน 20 หลัก'),
    region: (v) => (REGIONS.includes(v) ? null : 'ภูมิภาคไม่ถูกต้อง'),
    badge: (v) => (isEmpty(v) || (typeof v === 'string' && v.length <= 50) ? null : 'Badge ต้องไม่เกิน 50 ตัวอักษร'),
    avatar: (v) => (isEmpty(v) || isHttpUrl(v) ? null : URL_MSG),
  },
  player_tiers: {
    player_id: (v) => (isId(v) ? null : 'player_id ไม่ถูกต้อง'),
    mode_id: (v) => (isId(v) ? null : 'mode_id ไม่ถูกต้อง'),
    tier_type: (v) => (TIERS.includes(v) ? null : 'Tier ไม่ถูกต้อง'),
  },
  modes: {
    name: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.length <= 60 ? null : 'ชื่อ mode ต้องยาว 1–60 ตัวอักษร'),
    icon: (v) => (isEmpty(v) || (typeof v === 'string' && v.length <= 16) ? null : 'Icon ต้องไม่เกิน 16 ตัวอักษร'),
    icon_url: (v) => (isEmpty(v) || isHttpUrl(v) ? null : URL_MSG),
    sort_order: (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? null : 'sort_order ไม่ถูกต้อง'),
    include_in_overall: (v) => (typeof v === 'boolean' ? null : 'include_in_overall ต้องเป็น true/false'),
  },
  site_settings: {
    discord_url: (v) => (isEmpty(v) || isHttpUrl(v) ? null : URL_MSG),
    rankings_url: (v) => (isEmpty(v) || isHttpUrl(v) ? null : URL_MSG),
    api_docs_url: (v) => (isEmpty(v) || isHttpUrl(v) ? null : URL_MSG),
  },
};

// ฟิลด์ที่ต้องมีตอน POST
const REQUIRED_ON_POST = {
  players: ['name'],
  player_tiers: ['player_id', 'mode_id', 'tier_type'],
  modes: ['name'],
};

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      return undefined;
    }
  }
  return b;
}

function validateBody(table, method, body, role) {
  if (!isPlainObject(body)) return 'ข้อมูลที่ส่งมาไม่ถูกต้อง';
  const rules = FIELD_RULES[table];
  if (!rules) return 'ตารางนี้เขียนข้อมูลไม่ได้';

  const keys = Object.keys(body);
  if (keys.length === 0) return 'ไม่มีข้อมูลให้บันทึก';

  // แก้ไข tier ได้เฉพาะ tier_type (ย้าย tier ข้ามผู้เล่น/mode ไม่ได้)
  const allowed = table === 'player_tiers' && method === 'PATCH' ? ['tier_type'] : Object.keys(rules);
  for (const k of keys) {
    if (!allowed.includes(k)) return 'มีฟิลด์ที่ไม่อนุญาตในข้อมูลที่ส่งมา';
  }

  if (method === 'POST') {
    for (const k of REQUIRED_ON_POST[table] || []) {
      if (body[k] === undefined) return `ต้องระบุ ${k}`;
    }
  }

  for (const k of keys) {
    const err = rules[k](body[k]);
    if (err) return err;
  }

  // tester ตั้งตำแหน่ง (badge) และรูปผู้เล่นไม่ได้
  if (role === 'tester' && table === 'players' && (!isEmpty(body.badge) || !isEmpty(body.avatar))) {
    return 'บัญชี tester ตั้ง badge หรือรูปผู้เล่นไม่ได้';
  }
  return null;
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
  res.setHeader('Cache-Control', 'no-store');

  const method = req.method;

  // path ต้องเป็นตารางที่อนุญาตเท่านั้น
  const parsed = parsePath(req.query && req.query.path);
  if (!parsed) {
    return res.status(400).json({ error: 'path ไม่ถูกต้อง' });
  }
  const { table, query } = parsed;

  // ตรวจสิทธิ์ตาม role + ตาราง + method
  const allowedMethods = ACCESS[role][table] || [];
  if (!allowedMethods.includes(method)) {
    if (role === 'tester') {
      return res.status(403).json({ error: 'บัญชี tester ดูข้อมูลได้ เพิ่มผู้เล่น/Tier และแก้ไข Tier ได้เท่านั้น ลบไม่ได้' });
    }
    res.setHeader('Allow', allowedMethods.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ตรวจ query ตาม method
  if (method === 'GET') {
    if (!/^[A-Za-z0-9_=&.,*()\-]{0,300}$/.test(query)) {
      return res.status(400).json({ error: 'query ไม่ถูกต้อง' });
    }
  } else if (method === 'POST') {
    if (query) return res.status(400).json({ error: 'POST ห้ามมี query' });
  } else if (!/^id=eq\.[A-Za-z0-9_-]{1,64}$/.test(query)) {
    // PATCH / DELETE: ต้องระบุแถวด้วย id=eq.<id> เท่านั้น
    return res.status(400).json({ error: 'ต้องระบุแถวด้วย id=eq.<id> เท่านั้น' });
  }

  // ตรวจข้อมูลที่เขียน แล้วส่งต่อเฉพาะข้อมูลที่ผ่านแล้ว
  let bodyText;
  if (method === 'POST' || method === 'PATCH') {
    const body = readBody(req);
    const err = validateBody(table, method, body, role);
    if (err) return res.status(400).json({ error: err });
    bodyText = JSON.stringify(body);
  }

  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
  };

  const options = { method, headers };
  if (bodyText !== undefined) options.body = bodyText;

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
