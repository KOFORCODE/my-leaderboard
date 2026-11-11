-- สร้างจุดเริ่มต้นของกราฟ Tier Progression จาก Tier ปัจจุบันของผู้เล่นทุกคน
-- รันหลัง tier_history.sql ใน Supabase SQL Editor (รันซ้ำได้ ไม่สร้างแถวซ้ำ)
-- ถ้า player_tiers มีคอลัมน์ created_at จะใช้เวลานั้น ถ้าไม่มีจะใช้เวลาตอนรัน (now())

do $$
declare
  has_created boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'player_tiers' and column_name = 'created_at'
  ) into has_created;

  if has_created then
    insert into public.tier_history (player_id, mode_id, old_tier, new_tier, changed_at)
    select pt.player_id::text, pt.mode_id::text, null, pt.tier_type, pt.created_at
    from public.player_tiers pt
    where not exists (
      select 1 from public.tier_history h
      where h.player_id = pt.player_id::text and h.mode_id = pt.mode_id::text
    );
  else
    insert into public.tier_history (player_id, mode_id, old_tier, new_tier, changed_at)
    select pt.player_id::text, pt.mode_id::text, null, pt.tier_type, now()
    from public.player_tiers pt
    where not exists (
      select 1 from public.tier_history h
      where h.player_id = pt.player_id::text and h.mode_id = pt.mode_id::text
    );
  end if;
end $$;

-- ตรวจผล: ควรได้จำนวนแถวเท่ากับจำนวน Tier ที่มีอยู่ (นับเฉพาะคู่ player+mode ที่ยังไม่มีประวัติ)
-- select count(*) from public.tier_history;
