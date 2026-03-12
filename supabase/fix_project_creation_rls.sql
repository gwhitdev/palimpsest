-- Hotfix for project creation RLS issues.
-- Run in Supabase SQL editor for existing databases.

create or replace function public.create_project_for_current_user(project_name text)
returns table(id uuid, name text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  created_project_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Unauthorised';
  end if;

  if project_name is null or btrim(project_name) = '' then
    raise exception 'Project name is required.';
  end if;

  insert into public.projects (name, created_by)
  values (btrim(project_name), current_user_id)
  returning projects.id into created_project_id;

  return query
  select p.id, p.name, p.created_at
  from public.projects p
  where p.id = created_project_id;
end
$$;

grant execute on function public.create_project_for_current_user(text) to authenticated;

notify pgrst, 'reload schema';
