-- Phase 8: Realtime Shared Memory Sync
--
-- 只把三张 Memory 表加入 supabase_realtime publication。
--
-- 设计约束：Realtime 事件只作为 invalidation 信号，不读取 payload 的 new/old，
-- 因此本 migration 不设置 REPLICA IDENTITY FULL（FULL 会在每次 UPDATE/DELETE
-- 时把整行旧值写进 WAL）。若未来需要读取旧行，或需要对 DELETE 事件做基于
-- 非主键列的 RLS 行过滤，再单独评估 FULL。

do $$
begin
	if not exists (
		select 1
		from pg_publication_tables
		where pubname = 'supabase_realtime'
			and schemaname = 'public'
			and tablename = 'memories'
	) then
		alter publication supabase_realtime add table public.memories;
	end if;

	if not exists (
		select 1
		from pg_publication_tables
		where pubname = 'supabase_realtime'
			and schemaname = 'public'
			and tablename = 'perspectives'
	) then
		alter publication supabase_realtime add table public.perspectives;
	end if;

	if not exists (
		select 1
		from pg_publication_tables
		where pubname = 'supabase_realtime'
			and schemaname = 'public'
			and tablename = 'memory_photos'
	) then
		alter publication supabase_realtime add table public.memory_photos;
	end if;
end
$$;
