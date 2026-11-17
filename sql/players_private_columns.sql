

begin;

-- 1) view ที่เปิดเฉพาะคอลัมน์ที่หน้าเว็บใช้จริง
create or replace view public.players_public as
select id, name, avatar, region, badge, uid, created_at
from public.players;

grant select on public.players_public to anon, authenticated;

-- 2) ตัดสิทธิ์อ่านทั้งตาราง แล้วให้เฉพาะคอลัมน์ที่ปลอดภัย
--    (ถ้าลบ grant นี้ออก หน้าเว็บจะพัง เพราะ fallback ยัง select จาก players)
revoke select on public.players from anon, authenticated;
grant select (id, name, avatar, region, badge, uid, created_at)
  on public.players to anon, authenticated;

-- 3) RPC ใหม่ที่คืนเฉพาะคอลัมน์ปลอดภัย (index.html เรียกตัวนี้ก่อน)
create or replace function public.get_leaderboard_public()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'modes', coalesce((select json_agg(m order by m.sort_order) from public.modes m), '[]'::json),
    'players', coalesce((select json_agg(p order by p.name) from public.players_public p), '[]'::json),
    'player_tiers', coalesce((select json_agg(t) from public.player_tiers t), '[]'::json)
  );
$$;

revoke all on function public.get_leaderboard_public() from public;
grant execute on function public.get_leaderboard_public() to anon, authenticated, service_role;

-- 4) ปิด RPC เก่าที่คืน discord_id / cool_star_until ให้ anon เรียกไม่ได้
--    (หา signature จริงให้เอง รองรับทั้งแบบไม่มี argument และมี default)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_leaderboard_data'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

commit;

-- =====================================================================
-- ตรวจผลหลังรัน (ควรได้ 401/403 หรือ [] เมื่อยิงด้วย anon key)
--   GET /rest/v1/players?select=discord_id
--   POST /rest/v1/rpc/get_leaderboard_data
-- และหน้าเว็บควรยังทำงานได้ (เรียก get_leaderboard_public)
--
-- ถ้าต้องการย้อนกลับ:
--   grant select on public.players to anon, authenticated;
--   grant execute on function public.get_leaderboard_data() to anon, authenticated;
-- =====================================================================
