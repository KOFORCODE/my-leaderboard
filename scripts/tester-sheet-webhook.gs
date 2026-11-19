/**
 * Google Apps Script — รับใบสมัคร Tester จากเว็บ แล้วเพิ่มแถวลง Google Sheet
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 * 1. สร้าง Google Sheet ใหม่ ตั้งชื่อไฟล์ เช่น "AVEN TIER — Tester"
 *    (ไม่ต้องสร้างแท็บเอง สคริปต์จะสร้างแท็บชื่อ "Tester" ให้)
 * 2. ใน Sheet ไปที่ Extensions > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดนี้ทั้งไฟล์
 * 4. แก้ SECRET ด้านล่างเป็นรหัสลับที่ตั้งเอง (เช่น สุ่มตัวอักษรยาว ๆ)
 * 5. กด Deploy > New deployment > เลือก type "Web app"
 *    - Description: tester signup
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    กด Deploy แล้วอนุญาตสิทธิ์ (Authorize access)
 * 6. Copy "Web app URL" (ลงท้ายด้วย /exec)
 * 7. ไปที่ Vercel > Project > Settings > Environment Variables เพิ่ม:
 *    SHEET_WEBHOOK_URL    = <URL ที่ copy มา>
 *    SHEET_WEBHOOK_SECRET = <SECRET เดียวกันกับข้อ 4>
 *    แล้ว Redeploy
 *
 * ถ้าแก้โค้ดภายหลัง ต้อง Deploy > Manage deployments > Edit > Version: New version > Deploy
 */

var SHEET_NAME = 'Tester';
var SECRET = 'เปลี่ยนรหัสตรงนี้เป็นรหัสลับของคุณ';

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (SECRET && body.secret !== SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);

    // ใส่หัวตารางให้ครั้งแรก
    if (sh.getLastRow() === 0) {
      sh.appendRow(['วันที่สมัคร', 'ชื่อ', 'UID', 'Tier']);
      sh.getRange(1, 1, 1, 4).setFontWeight('bold');
      sh.setFrozenRows(1);
    }

    var tz = Session.getScriptTimeZone();
    var when = body.created_at ? new Date(body.created_at) : new Date();
    sh.appendRow([
      Utilities.formatDate(when, tz, 'dd/MM/yyyy HH:mm'),
      body.name || '',
      body.uid || '',
      body.tier || ''
    ]);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
