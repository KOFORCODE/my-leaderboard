-- โปสเตอร์หน้าแรก: ใส่ URL รูปจากหน้า admin (ว่าง = ไม่แสดงโปสเตอร์)
-- รันใน Supabase SQL Editor ครั้งเดียว ก่อนบันทึกจากหน้า admin

alter table public.site_settings add column if not exists poster_url text;
