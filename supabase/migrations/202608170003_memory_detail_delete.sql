-- Phase 9: Memory Detail + Edit/Delete — Storage cleanup for deleted Memory
--
-- 删除整条 Memory 时，creator 需要在 DB 行删除成功后再清理该 Memory 的
-- Storage 文件（含对方上传的照片）。由于删除发生前我们把 memory.photos 的
-- storage_path 全部保存在客户端，Storage 清理直接 remove(photoPaths)，
-- 不需要递归 list。此处因此不需要 list 权限，也不需要放宽正常照片 ownership。
--
-- 新策略专门用于「Memory 已不存在」的 orphan objects：
--   当前用户必须仍是 path 中 spaceId 的成员，
--   且 path 中 memoryId 在 memories 表中已不存在。
-- Memory 仍存在时，本策略不生效，继续走现有 memory_images_delete_own_path
-- （每人只能删除自己的照片）。storage.objects 同一动作的多条 policy 是 OR 关系，
-- 因此两个策略并存且互不影响。

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
