-- Run in this project's Supabase Dashboard > SQL Editor.
-- Existing memories and accounts are preserved. Safe to run again.
begin;
-- Phase 11.2: make post-delete Storage cleanup observable and effective.
--
-- Supabase Storage's remove API needs to be able to SELECT an object before it
-- can delete it. After a Memory row is deleted, memory_images_select_members no
-- longer exposes that object's path because memory_belongs_to_space() is false.
-- The existing orphan DELETE policy therefore matches in SQL, but the Storage
-- API returns an empty result and leaves the object behind.
--
-- The hosted Storage API exposes its active operation to RLS. Restrict orphan
-- SELECT visibility to delete/delete_many so members still cannot list,
-- download, or create signed URLs for an orphan after its Memory is gone.

do $$
begin
	if to_regprocedure('storage.allow_any_operation(text[])') is null then
		raise exception 'storage.allow_any_operation(text[]) is required';
	end if;
end
$$;

drop policy if exists "memory_images_select_orphan_for_delete" on storage.objects;
create policy "memory_images_select_orphan_for_delete"
	on storage.objects
	for select
	to authenticated
	using (
		bucket_id = 'memory-images'
		and storage.allow_any_operation(array[
			'storage.object.delete',
			'storage.object.delete_many'
		])
		and public.is_space_member(public.path_segment_uuid(name, 1))
		and not exists (
			select 1
			from public.memories m
			where m.id = public.path_segment_uuid(name, 2)
		)
	);

-- Recreate the companion DELETE policy so this migration remains sufficient
-- and repeatable even if an environment missed the original Phase 9 migration.
drop policy if exists "memory_images_delete_orphan_member" on storage.objects;
create policy "memory_images_delete_orphan_member"
	on storage.objects
	for delete
	to authenticated
	using (
		bucket_id = 'memory-images'
		and public.is_space_member(public.path_segment_uuid(name, 1))
		and not exists (
			select 1
			from public.memories m
			where m.id = public.path_segment_uuid(name, 2)
		)
	);

do $$
begin
	if not exists (
		select 1
		from pg_policies
		where schemaname = 'storage'
			and tablename = 'objects'
			and policyname = 'memory_images_select_orphan_for_delete'
			and cmd = 'SELECT'
	) then
		raise exception 'memory_images_select_orphan_for_delete was not created';
	end if;

	if not exists (
		select 1
		from pg_policies
		where schemaname = 'storage'
			and tablename = 'objects'
			and policyname = 'memory_images_delete_orphan_member'
			and cmd = 'DELETE'
	) then
		raise exception 'memory_images_delete_orphan_member was not created';
	end if;
end
$$;

-- A single transaction creates a Memory and its first Perspective.
-- SECURITY INVOKER preserves all existing RLS and ownership checks.
create or replace function public.create_memory_with_perspective(
  p_id uuid, p_space_id uuid, p_date date, p_title text, p_location text, p_content text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  item public.memories;
  perspective public.perspectives;
begin
  if auth.uid() is null or not public.is_space_member(p_space_id) then
    raise exception 'Space membership required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_content, ''))) = 0 then
    raise exception 'Perspective content is required' using errcode = '22023';
  end if;

  insert into public.memories (id, space_id, created_by, memory_date, title, location)
  values (p_id, p_space_id, auth.uid(), p_date, p_title, p_location)
  on conflict (id) do nothing;

  select * into item from public.memories where id = p_id for update;
  if item.id is null or item.created_by <> auth.uid() or item.space_id <> p_space_id then
    raise exception 'Invalid request owner' using errcode = '42501';
  end if;

  insert into public.perspectives (memory_id, user_id, content)
  values (p_id, auth.uid(), btrim(p_content))
  on conflict (memory_id, user_id) do nothing;

  select * into perspective from public.perspectives
  where memory_id = p_id and user_id = auth.uid();
  return to_jsonb(item) || jsonb_build_object('perspectives', jsonb_build_array(to_jsonb(perspective)), 'memory_photos', '[]'::jsonb);
end;
$$;

revoke all on function public.create_memory_with_perspective(uuid, uuid, date, text, text, text) from public, anon;
grant execute on function public.create_memory_with_perspective(uuid, uuid, date, text, text, text) to authenticated;

commit;
notify pgrst, 'reload schema';
