-- Registration support for self-serve sign-up
-- Run this if your database was initialized before trigger/policy support existed.
-- Prerequisite: run supabase/base_schema.sql first.

do $$
begin
  if to_regclass('public.projects') is null then
    raise exception 'Missing table public.projects. Run supabase/base_schema.sql first.';
  end if;

  if to_regclass('public.project_memberships') is null then
    raise exception 'Missing table public.project_memberships. Run supabase/base_schema.sql first.';
  end if;
end
$$;

alter table if exists public.coders enable row level security;

drop policy if exists "Authenticated users can read coders" on public.coders;
create policy "Authenticated users can read coders"
  on public.coders for select to authenticated using (true);

drop policy if exists "Users can insert own coder profile" on public.coders;
create policy "Users can insert own coder profile"
  on public.coders for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update own coder profile" on public.coders;
create policy "Users can update own coder profile"
  on public.coders for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_name text;
  personal_project_id uuid;
begin
  derived_name := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1),
    'Coder'
  );

  insert into public.coders (id, display_name)
  values (new.id, derived_name)
  on conflict (id) do nothing;

  insert into public.projects (name, created_by)
  values (derived_name || '''s Project', new.id)
  returning id into personal_project_id;

  insert into public.project_memberships (project_id, user_id, role, status, invited_by)
  values (personal_project_id, new.id, 'owner', 'active', new.id)
  on conflict (project_id, user_id) do nothing;

  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any existing auth users missing a coder profile.
insert into public.coders (id, display_name)
select
  users.id,
  coalesce(users.raw_user_meta_data->>'display_name', split_part(users.email, '@', 1), 'Coder')
from auth.users as users
left join public.coders as coders
  on coders.id = users.id
where coders.id is null;

insert into public.projects (name, created_by)
select
  coalesce(users.raw_user_meta_data->>'display_name', split_part(users.email, '@', 1), 'Coder') || '''s Project',
  users.id
from auth.users as users
where not exists (
  select 1
  from public.project_memberships memberships
  where memberships.user_id = users.id
    and memberships.role = 'owner'
    and memberships.status = 'active'
);

insert into public.project_memberships (project_id, user_id, role, status, invited_by)
select
  projects.id,
  projects.created_by,
  'owner',
  'active',
  projects.created_by
from public.projects
left join public.project_memberships memberships
  on memberships.project_id = projects.id
 and memberships.user_id = projects.created_by
where projects.created_by is not null
  and memberships.project_id is null;
