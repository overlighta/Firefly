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
