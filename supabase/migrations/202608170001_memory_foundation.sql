create extension if not exists pgcrypto;

create table if not exists public.profiles (
	id uuid primary key references auth.users(id) on delete cascade,
	display_name text not null,
	avatar_url text,
	theme_color text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.spaces (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	created_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.space_members (
	space_id uuid not null references public.spaces(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	joined_at timestamptz not null default now(),
	primary key (space_id, user_id)
);

create table if not exists public.memories (
	id uuid primary key default gen_random_uuid(),
	space_id uuid not null references public.spaces(id) on delete cascade,
	memory_date date not null,
	title text,
	location text,
	latitude double precision,
	longitude double precision,
	weather text,
	temperature text,
	song_title text,
	song_artist text,
	note text,
	created_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.perspectives (
	id uuid primary key default gen_random_uuid(),
	memory_id uuid not null references public.memories(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	content text not null default '',
	mood text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint perspectives_memory_user_key unique (memory_id, user_id)
);

create table if not exists public.memory_photos (
	id uuid primary key default gen_random_uuid(),
	memory_id uuid not null references public.memories(id) on delete cascade,
	uploaded_by uuid references auth.users(id),
	storage_path text not null,
	width integer,
	height integer,
	sort_order integer not null default 0,
	created_at timestamptz not null default now()
);

create index if not exists space_members_user_id_idx on public.space_members(user_id);
create index if not exists memories_space_id_idx on public.memories(space_id);
create index if not exists memories_memory_date_idx on public.memories(memory_date);
create index if not exists memories_space_id_memory_date_idx on public.memories(space_id, memory_date desc);
create index if not exists perspectives_memory_id_idx on public.perspectives(memory_id);
create index if not exists perspectives_user_id_idx on public.perspectives(user_id);
create index if not exists memory_photos_memory_id_idx on public.memory_photos(memory_id);
create index if not exists memory_photos_uploaded_by_idx on public.memory_photos(uploaded_by);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
	before update on public.profiles
	for each row execute function public.set_updated_at();

drop trigger if exists set_spaces_updated_at on public.spaces;
create trigger set_spaces_updated_at
	before update on public.spaces
	for each row execute function public.set_updated_at();

drop trigger if exists set_memories_updated_at on public.memories;
create trigger set_memories_updated_at
	before update on public.memories
	for each row execute function public.set_updated_at();

drop trigger if exists set_perspectives_updated_at on public.perspectives;
create trigger set_perspectives_updated_at
	before update on public.perspectives
	for each row execute function public.set_updated_at();

create or replace function public.is_space_member(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.space_members sm
		where sm.space_id = target_space_id
			and sm.user_id = auth.uid()
	);
$$;

create or replace function public.is_space_creator(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.spaces s
		where s.id = target_space_id
			and s.created_by = auth.uid()
	);
$$;

create or replace function public.is_memory_member(target_memory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.memories m
		join public.space_members sm on sm.space_id = m.space_id
		where m.id = target_memory_id
			and sm.user_id = auth.uid()
	);
$$;

create or replace function public.shares_space_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select auth.uid() = target_user_id
		or exists (
			select 1
			from public.space_members mine
			join public.space_members theirs on theirs.space_id = mine.space_id
			where mine.user_id = auth.uid()
				and theirs.user_id = target_user_id
		);
$$;

create or replace function public.memory_belongs_to_space(target_memory_id uuid, target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.memories m
		where m.id = target_memory_id
			and m.space_id = target_space_id
	);
$$;

create or replace function public.path_segment_uuid(object_name text, segment_index integer)
returns uuid
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
	segment text;
begin
	segment := (storage.foldername(object_name))[segment_index];
	return segment::uuid;
exception
	when others then
		return null;
end;
$$;

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.memories enable row level security;
alter table public.perspectives enable row level security;
alter table public.memory_photos enable row level security;

drop policy if exists "profiles_select_shared_space" on public.profiles;
create policy "profiles_select_shared_space"
	on public.profiles
	for select
	to authenticated
	using (public.shares_space_with(id));

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
	on public.profiles
	for insert
	to authenticated
	with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
	on public.profiles
	for update
	to authenticated
	using (id = auth.uid())
	with check (id = auth.uid());

drop policy if exists "spaces_select_members" on public.spaces;
create policy "spaces_select_members"
	on public.spaces
	for select
	to authenticated
	using (public.is_space_member(id));

drop policy if exists "spaces_insert_creator" on public.spaces;
create policy "spaces_insert_creator"
	on public.spaces
	for insert
	to authenticated
	with check (created_by = auth.uid());

drop policy if exists "spaces_update_members" on public.spaces;
create policy "spaces_update_members"
	on public.spaces
	for update
	to authenticated
	using (public.is_space_member(id))
	with check (public.is_space_member(id));

drop policy if exists "space_members_select_space_members" on public.space_members;
create policy "space_members_select_space_members"
	on public.space_members
	for select
	to authenticated
	using (public.is_space_member(space_id));

drop policy if exists "space_members_insert_self_for_created_space" on public.space_members;
create policy "space_members_insert_self_for_created_space"
	on public.space_members
	for insert
	to authenticated
	with check (
		user_id = auth.uid()
		and public.is_space_creator(space_id)
	);

drop policy if exists "space_members_delete_self" on public.space_members;
create policy "space_members_delete_self"
	on public.space_members
	for delete
	to authenticated
	using (user_id = auth.uid());

drop policy if exists "memories_select_members" on public.memories;
create policy "memories_select_members"
	on public.memories
	for select
	to authenticated
	using (public.is_space_member(space_id));

drop policy if exists "memories_insert_members" on public.memories;
create policy "memories_insert_members"
	on public.memories
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and public.is_space_member(space_id)
	);

drop policy if exists "memories_update_members" on public.memories;
create policy "memories_update_members"
	on public.memories
	for update
	to authenticated
	using (public.is_space_member(space_id))
	with check (public.is_space_member(space_id));

drop policy if exists "memories_delete_creator" on public.memories;
create policy "memories_delete_creator"
	on public.memories
	for delete
	to authenticated
	using (created_by = auth.uid());

drop policy if exists "perspectives_select_memory_members" on public.perspectives;
create policy "perspectives_select_memory_members"
	on public.perspectives
	for select
	to authenticated
	using (public.is_memory_member(memory_id));

drop policy if exists "perspectives_insert_self" on public.perspectives;
create policy "perspectives_insert_self"
	on public.perspectives
	for insert
	to authenticated
	with check (
		user_id = auth.uid()
		and public.is_memory_member(memory_id)
	);

drop policy if exists "perspectives_update_self" on public.perspectives;
create policy "perspectives_update_self"
	on public.perspectives
	for update
	to authenticated
	using (user_id = auth.uid())
	with check (
		user_id = auth.uid()
		and public.is_memory_member(memory_id)
	);

drop policy if exists "perspectives_delete_self" on public.perspectives;
create policy "perspectives_delete_self"
	on public.perspectives
	for delete
	to authenticated
	using (user_id = auth.uid());

drop policy if exists "memory_photos_select_memory_members" on public.memory_photos;
create policy "memory_photos_select_memory_members"
	on public.memory_photos
	for select
	to authenticated
	using (public.is_memory_member(memory_id));

drop policy if exists "memory_photos_insert_own_upload" on public.memory_photos;
create policy "memory_photos_insert_own_upload"
	on public.memory_photos
	for insert
	to authenticated
	with check (
		uploaded_by = auth.uid()
		and public.is_memory_member(memory_id)
	);

drop policy if exists "memory_photos_delete_own_upload" on public.memory_photos;
create policy "memory_photos_delete_own_upload"
	on public.memory_photos
	for delete
	to authenticated
	using (uploaded_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'memory-images',
	'memory-images',
	false,
	10485760,
	array[
		'image/jpeg',
		'image/png',
		'image/webp',
		'image/heic',
		'image/heif'
	]
)
on conflict (id) do update
set public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "memory_images_select_members" on storage.objects;
create policy "memory_images_select_members"
	on storage.objects
	for select
	to authenticated
	using (
		bucket_id = 'memory-images'
		and public.is_space_member(public.path_segment_uuid(name, 1))
		and public.memory_belongs_to_space(
			public.path_segment_uuid(name, 2),
			public.path_segment_uuid(name, 1)
		)
	);

drop policy if exists "memory_images_insert_own_path" on storage.objects;
create policy "memory_images_insert_own_path"
	on storage.objects
	for insert
	to authenticated
	with check (
		bucket_id = 'memory-images'
		and public.path_segment_uuid(name, 3) = auth.uid()
		and public.is_space_member(public.path_segment_uuid(name, 1))
		and public.memory_belongs_to_space(
			public.path_segment_uuid(name, 2),
			public.path_segment_uuid(name, 1)
		)
	);

drop policy if exists "memory_images_delete_own_path" on storage.objects;
create policy "memory_images_delete_own_path"
	on storage.objects
	for delete
	to authenticated
	using (
		bucket_id = 'memory-images'
		and public.path_segment_uuid(name, 3) = auth.uid()
		and public.is_space_member(public.path_segment_uuid(name, 1))
		and public.memory_belongs_to_space(
			public.path_segment_uuid(name, 2),
			public.path_segment_uuid(name, 1)
		)
	);
