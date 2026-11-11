-- ประวัติ Tier: บันทึกทุกครั้งที่ player_tiers ถูกเพิ่ม / เปลี่ยน / ลบ
-- รันใน Supabase SQL Editor ครั้งเดียว
-- shortcut: ไม่มี backfill ประวัติเดิม (ข้อมูลก่อนรันไฟล์นี้ไม่มีวันที่), ใช้ได้ตั้งแต่รันเป็นต้นไป

create table if not exists public.tier_history (
  id bigint generated always as identity primary key,
  player_id text not null,
  mode_id text not null,
  old_tier text,
  new_tier text,
  changed_at timestamptz not null default now()
);

create index if not exists tier_history_player_idx on public.tier_history (player_id, changed_at desc);

create or replace function public.log_tier_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.tier_history (player_id, mode_id, old_tier, new_tier)
    values (NEW.player_id::text, NEW.mode_id::text, null, NEW.tier_type);
    return null;
  elsif TG_OP = 'UPDATE' then
    if NEW.tier_type is distinct from OLD.tier_type then
      insert into public.tier_history (player_id, mode_id, old_tier, new_tier)
      values (NEW.player_id::text, NEW.mode_id::text, OLD.tier_type, NEW.tier_type);
    end if;
    return null;
  else -- DELETE
    insert into public.tier_history (player_id, mode_id, old_tier, new_tier)
    values (OLD.player_id::text, OLD.mode_id::text, OLD.tier_type, null);
    return null;
  end if;
end;
$$;

drop trigger if exists player_tiers_history on public.player_tiers;
create trigger player_tiers_history
after insert or update or delete on public.player_tiers
for each row execute function public.log_tier_change();

-- ให้หน้าเว็บ (anon key) อ่านได้อย่างเดียว การเขียนทำผ่าน trigger เท่านั้น
alter table public.tier_history enable row level security;
drop policy if exists "tier_history read" on public.tier_history;
create policy "tier_history read" on public.tier_history for select to anon, authenticated using (true);

-- ทดสอบ (ไม่บังคับ): เปลี่ยน tier แถวใดแถวหนึ่งแล้วดูว่ามีแถวใหม่ใน tier_history
-- select * from public.tier_history order by id desc limit 5;
