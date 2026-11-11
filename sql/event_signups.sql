-- ระบบสมัคร Event: เก็บรายชื่อผู้เล่นที่สมัคร
-- รันใน Supabase SQL Editor ครั้งเดียว

create table if not exists public.event_signups (
  id bigint generated always as identity primary key,
  event_key text not null default 'main',   -- แยกหลาย event ได้ (ตรงกับ EVENT_KEY ใน api/event-signup.js)
  player_id text not null,
  uid text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (event_key, player_id)              -- 1 คนสมัครได้ 1 ครั้งต่อ event
);

-- ปิด RLS ไว้โดยไม่สร้าง policy: anon key อ่าน/เขียนไม่ได้
-- การสมัครผ่าน api/event-signup.js (ใช้ SUPABASE_SECRET_KEY) และแอดมินอ่านผ่าน api/admin.js
alter table public.event_signups enable row level security;

-- ดึงรายชื่อไปใส่ sheet "best" (รันใน SQL Editor แล้ว copy ผลลัพธ์):
-- select name, uid, created_at from public.event_signups where event_key = 'main' order by created_at;
