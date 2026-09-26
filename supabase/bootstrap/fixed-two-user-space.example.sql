-- Manual bootstrap template for the fixed two-user private space.
-- Replace only the two UUID placeholders with the Auth user IDs created in Supabase Dashboard.
-- Do not paste email addresses or passwords into this file.

do $$
declare
	overlight_user_id uuid := '<OVERLIGHT_USER_UUID>';
	rain_user_id uuid := '<RAIN_USER_UUID>';
	target_space_id uuid;
begin
	insert into public.profiles (id, display_name, theme_color)
	values
		(overlight_user_id, 'overlight', '#A9B5A7'),
		(rain_user_id, '落雨带伞', '#8CA1B7')
	on conflict (id) do update
	set display_name = excluded.display_name,
		theme_color = excluded.theme_color,
		updated_at = now();

	select id
	into target_space_id
	from public.spaces
	where name = '我们'
		and (
			created_by in (overlight_user_id, rain_user_id)
			or exists (
				select 1
				from public.space_members sm
				where sm.space_id = spaces.id
					and sm.user_id in (overlight_user_id, rain_user_id)
			)
		)
	order by created_at asc
	limit 1;

	if target_space_id is null then
		insert into public.spaces (name, created_by)
		values ('我们', overlight_user_id)
		returning id into target_space_id;
	end if;

	insert into public.space_members (space_id, user_id)
	values
		(target_space_id, overlight_user_id),
		(target_space_id, rain_user_id)
	on conflict (space_id, user_id) do nothing;
end $$;
