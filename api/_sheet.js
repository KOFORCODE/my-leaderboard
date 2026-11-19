// api/_sheet.js
// ส่งข้อมูลใบสมัครไปยัง Google Sheet ผ่าน Apps Script Web App (ไม่บังคับ)
// ตั้งค่าใน Vercel > Environment Variables:
//   SHEET_WEBHOOK_URL    = URL ของ Apps Script Web App (ลงท้าย /exec)
//   SHEET_WEBHOOK_SECRET = รหัสลับที่ตรงกับในสคริปต์ (ไม่บังคับ แต่แนะนำ)
// ถ้ายังไม่ตั้ง SHEET_WEBHOOK_URL ระบบจะข้ามการเขียนชีต โดยการสมัครยังทำงานปกติ

export async function appendSignupToSheet(row) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) return;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.SHEET_WEBHOOK_SECRET || '',
        ...row,
      }),
      redirect: 'follow',
      // Apps Script ช้าได้บ้าง แต่ไม่ควรทำให้ผู้ใช้รอเกิน 6 วินาที
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) console.error('[sheet] webhook ตอบกลับ', r.status);
  } catch (e) {
    // เขียนชีตพลาดไม่ควรทำให้การสมัครล้มเหลว (ข้อมูลอยู่ใน Supabase แล้ว)
    console.error('[sheet] webhook error:', e.message);
  }
}
