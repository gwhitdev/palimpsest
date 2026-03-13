-- Project lifecycle support: close/archive/delete controls for owners.

alter table if exists public.projects
  add column if not exists status text;

update public.projects
set status = 'active'
where status is null;

alter table public.projects
  alter column status set default 'active';

alter table public.projects
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_status_check'
  ) then
    alter table public.projects
      add constraint projects_status_check
      check (status in ('active', 'closed', 'archived'));
  end if;
end
$$;

drop policy if exists "Owners can delete projects" on public.projects;
create policy "Owners can delete projects"
  on public.projects for delete to authenticated
  using (public.project_has_permission(projects.id, auth.uid(), 'manage_project'));
