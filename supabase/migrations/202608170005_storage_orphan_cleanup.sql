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
