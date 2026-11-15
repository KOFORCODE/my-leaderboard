// ตรรกะสายการแข่งขัน: คำนวณคู่แข่งของแต่ละแมตช์จากผู้ชนะรอบก่อน
// ใช้ร่วมกันระหว่าง api/bracket.js (หน้าเว็บ) — แอดมินตั้งค่าดิบผ่าน api/admin.js

const ROUND_OF = { 1: 'qf', 2: 'qf', 3: 'qf', 4: 'qf', 5: 'sf', 6: 'sf', 7: 'final' };

// rows = แถวจาก event_bracket  →  คืน [{id, round, a, b, winner}] เรียงตาม id
export function resolveBracket(rows) {
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const raw = (id, key) => by[id]?.[key] || null;
  const winner = (id) => raw(id, 'winner_uid');
  const slots = {
    1: { a: raw(1, 'a_uid'), b: raw(1, 'b_uid') },
    2: { a: raw(2, 'a_uid'), b: raw(2, 'b_uid') },
    3: { a: raw(3, 'a_uid'), b: raw(3, 'b_uid') },
    4: { a: raw(4, 'a_uid'), b: raw(4, 'b_uid') },
    5: { a: raw(5, 'a_uid') || winner(1), b: raw(5, 'b_uid') || winner(2) },
    6: { a: raw(6, 'a_uid') || winner(3), b: raw(6, 'b_uid') || winner(4) },
    7: { a: raw(7, 'a_uid') || winner(5), b: raw(7, 'b_uid') || winner(6) },
  };
  return [1, 2, 3, 4, 5, 6, 7].map((id) => {
    const s = slots[id];
    // ผู้ชนะต้องเป็นหนึ่งในสองฝั่งของแมตช์นั้นเท่านั้น
    const w = winner(id);
    const won = w && (w === s.a || w === s.b) ? w : null;
    return { id, round: ROUND_OF[id], a: s.a, b: s.b, winner: won };
  });
}
