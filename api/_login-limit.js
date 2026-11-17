// จำกัดการลองรหัสแอดมิน: ผิดเกิน MAX_FAILS ครั้งใน WINDOW_MS จะถูกล็อกจนหมดช่วง
// ใช้ x-vercel-forwarded-for (Vercel เป็นคนเขียนให้ ผู้ส่งแก้ไม่ได้) ก่อน แล้วค่อย x-forwarded-for ตัวแรก
// shortcut: ตัวนับอยู่ใน memory ของแต่ละ instance, ถ้า Vercel เปิดหลาย instance การจำกัดจะหลวมลง, upgrade: เก็บตัวนับใน Supabase หรือ Upstash
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map();

export function clientIp(req) {
  const trusted = String(req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim();
  if (trusted) return trusted;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}

export function isLocked(req) {
  const k = clientIp(req);
  const e = fails.get(k);
  if (!e) return false;
  if (Date.now() > e.reset) {
    fails.delete(k);
    return false;
  }
  return e.count >= MAX_FAILS;
}

export function recordFail(req) {
  if (fails.size > 5000) fails.clear(); // กัน memory โตไม่จำกัด
  const k = clientIp(req);
  const now = Date.now();
  let e = fails.get(k);
  if (!e || now > e.reset) e = { count: 0, reset: now + WINDOW_MS };
  e.count++;
  fails.set(k, e);
}
