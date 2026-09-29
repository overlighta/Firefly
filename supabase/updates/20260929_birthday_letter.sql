-- Birthday letter for 2026-09-30, Asia/Shanghai. Run once in Supabase SQL Editor.
-- Creates a private, initially unpublished letter. Existing memories are untouched.
begin;

create table if not exists public.birthday_letters (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  occasion_key text not null,
  sender_id uuid not null references auth.users(id),
  recipient_id uuid not null references auth.users(id),
  recipient_name text not null,
  opens_at timestamptz not null,
  body text not null default '',
  signature text not null default '',
  is_ready boolean not null default false,
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (space_id, occasion_key),
  check (sender_id <> recipient_id),
  check (length(body) <= 20000),
  check (length(signature) <= 80),
  check (not is_ready or length(btrim(body)) > 0)
);
alter table public.birthday_letters enable row level security;
revoke all on public.birthday_letters from anon, authenticated;
grant select on public.birthday_letters to authenticated;
grant update (body, signature, is_ready) on public.birthday_letters to authenticated;

drop policy if exists birthday_letter_read on public.birthday_letters;
create policy birthday_letter_read on public.birthday_letters for select to authenticated
using (public.is_space_member(space_id) and (
  sender_id = (select auth.uid()) or
  (recipient_id = (select auth.uid()) and is_ready and opens_at <= now())
));
drop policy if exists birthday_letter_edit on public.birthday_letters;
create policy birthday_letter_edit on public.birthday_letters for update to authenticated
using (sender_id = (select auth.uid()) and public.is_space_member(space_id))
with check (sender_id = (select auth.uid()) and public.is_space_member(space_id));

create or replace function public.touch_birthday_letter()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists birthday_letter_updated on public.birthday_letters;
create trigger birthday_letter_updated before update on public.birthday_letters
for each row execute function public.touch_birthday_letter();

create or replace function public.open_birthday_letter(letter_id uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare opened timestamptz;
begin
  update public.birthday_letters
  set opened_at = coalesce(opened_at, now())
  where id = letter_id and recipient_id = auth.uid()
    and public.is_space_member(space_id) and is_ready and opens_at <= now()
  returning opened_at into opened;
  if opened is null then raise exception 'Letter is not available' using errcode = '42501'; end if;
  return opened;
end;
$$;
revoke all on function public.open_birthday_letter(uuid) from public, anon;
grant execute on function public.open_birthday_letter(uuid) to authenticated;

do $$
declare sender uuid; recipient uuid; shared_space uuid; matching_spaces integer;
begin
  select id into strict sender from auth.users where lower(email) = 'overlight@firefly.test';
  select id into strict recipient from auth.users where lower(email) = 'luoyu@firefly.test';
  select count(*) into matching_spaces from public.space_members a join public.space_members b
    on a.space_id = b.space_id where a.user_id = sender and b.user_id = recipient;
  if matching_spaces <> 1 then raise exception 'Expected one shared space for the two existing accounts'; end if;
  select a.space_id into shared_space from public.space_members a join public.space_members b
    on a.space_id = b.space_id where a.user_id = sender and b.user_id = recipient;
  insert into public.birthday_letters (space_id, occasion_key, sender_id, recipient_id, recipient_name, opens_at, signature)
  values (shared_space, 'birthday-2026-09-30', sender, recipient, '小刘老师', '2026-09-30 00:00:00+08', 'overlight')
  on conflict (space_id, occasion_key) do nothing;
end;
$$;

notify pgrst, 'reload schema';
commit;
