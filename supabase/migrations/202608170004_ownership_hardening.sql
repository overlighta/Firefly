-- Phase 11.2: RLS Ownership Hardening
--
-- Row-level policies decide which rows a Space member may update, but they do
-- not restrict which columns in those rows may change. Memory deletion depends
-- on memories.created_by, and Space bootstrap authority depends on
-- spaces.created_by. Both ownership columns must therefore remain immutable to
-- browser roles.
--
-- This migration applies two independent controls:
--   1. authenticated receives UPDATE only for the shared editable columns;
--   2. BEFORE UPDATE triggers reject ownership changes even if a future grant
--      accidentally broadens column privileges.
--
-- Service/admin roles are not changed. Existing row-level policies continue to
-- decide which Space rows each authenticated user may edit.

revoke update on table public.memories from anon, authenticated;
revoke update (
	id,
	space_id,
	created_by,
	created_at,
	updated_at
) on table public.memories from anon, authenticated;

grant update (
	memory_date,
	title,
	location,
	latitude,
	longitude,
	weather,
	temperature,
	song_title,
	song_artist,
	note
) on table public.memories to authenticated;

revoke update on table public.spaces from anon, authenticated;
revoke update (
	id,
	created_by,
	created_at,
	updated_at
) on table public.spaces from anon, authenticated;

grant update (name) on table public.spaces to authenticated;

create or replace function public.reject_memory_ownership_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
	if new.id is distinct from old.id
		or new.space_id is distinct from old.space_id
		or new.created_by is distinct from old.created_by then
		raise exception 'Memory ownership fields are immutable.'
			using errcode = '42501';
	end if;

	return new;
end;
$$;

revoke all on function public.reject_memory_ownership_change() from public;

drop trigger if exists reject_memory_ownership_change on public.memories;
create trigger reject_memory_ownership_change
	before update of id, space_id, created_by on public.memories
	for each row execute function public.reject_memory_ownership_change();

create or replace function public.reject_space_ownership_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
	if new.id is distinct from old.id
		or new.created_by is distinct from old.created_by then
		raise exception 'Space ownership fields are immutable.'
			using errcode = '42501';
	end if;

	return new;
end;
$$;

revoke all on function public.reject_space_ownership_change() from public;

drop trigger if exists reject_space_ownership_change on public.spaces;
create trigger reject_space_ownership_change
	before update of id, created_by on public.spaces
	for each row execute function public.reject_space_ownership_change();

-- Fail the migration if a protected column remains writable or an application
-- editable column was not granted. These checks also make repeat execution safe.
do $$
declare
	protected_column text;
	editable_column text;
begin
	if has_table_privilege('authenticated', 'public.memories', 'update') then
		raise exception 'authenticated still has table-level UPDATE on memories';
	end if;

	if has_table_privilege('authenticated', 'public.spaces', 'update') then
		raise exception 'authenticated still has table-level UPDATE on spaces';
	end if;

	foreach protected_column in array array[
		'id', 'space_id', 'created_by', 'created_at', 'updated_at'
	] loop
		if has_column_privilege(
			'authenticated',
			'public.memories',
			protected_column,
			'update'
		) then
			raise exception 'authenticated can still update memories.%', protected_column;
		end if;
	end loop;

	foreach editable_column in array array[
		'memory_date', 'title', 'location', 'latitude', 'longitude',
		'weather', 'temperature', 'song_title', 'song_artist', 'note'
	] loop
		if not has_column_privilege(
			'authenticated',
			'public.memories',
			editable_column,
			'update'
		) then
			raise exception 'authenticated cannot update memories.%', editable_column;
		end if;
	end loop;

	foreach protected_column in array array[
		'id', 'created_by', 'created_at', 'updated_at'
	] loop
		if has_column_privilege(
			'authenticated',
			'public.spaces',
			protected_column,
			'update'
		) then
			raise exception 'authenticated can still update spaces.%', protected_column;
		end if;
	end loop;

	if not has_column_privilege(
		'authenticated',
		'public.spaces',
		'name',
		'update'
	) then
		raise exception 'authenticated cannot update spaces.name';
	end if;
end
$$;
