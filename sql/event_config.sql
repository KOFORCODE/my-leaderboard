-- ตั้งค่า Event ที่แก้ได้จากหน้า admin (มีแถวเดียว id = 1 เหมือน site_settings)
-- รันใน Supabase SQL Editor ครั้งเดียว

create table if not exists public.event_config (
  id integer primary key default 1 check (id = 1),
  title text not null default 'AVEN TIER Event',
  description text not null default 'สมัครเข้าร่วม Event ของ AVEN TIER เฉพาะผู้เล่นที่มีอันดับในเว็บ',
  is_open boolean not null default true,
  min_tier text not null default 'D+' check (min_tier in ('S','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F')),
  mode_name text,            -- ว่าง = นับ Tier ทุกโหมด
  closes_at timestamptz      -- ว่าง = ไม่มีวันปิด
);

insert into public.event_config (id) values (1) on conflict (id) do nothing;

-- ไม่สร้าง policy: anon key อ่านไม่ได้ อ่านผ่าน api/event-signup.js และ api/admin.js เท่านั้น
alter table public.event_config enable row level security;
