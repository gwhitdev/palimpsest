-- Project-level settings for statistics visibility.
-- Prerequisite: run supabase/base_schema.sql and supabase/project_multitenancy_migration.sql.

create extension if not exists "uuid-ossp";

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  stats_visible_to_coders boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.project_settings enable row level security;

drop policy if exists "Members can read project settings" on public.project_settings;
create policy "Members can read project settings"
  on public.project_settings for select to authenticated
  using (public.project_has_permission(project_settings.project_id, auth.uid(), 'view_documents'));

drop policy if exists "Owners can manage project settings" on public.project_settings;
create policy "Owners can manage project settings"
  on public.project_settings for all to authenticated
  using (public.project_has_permission(project_settings.project_id, auth.uid(), 'manage_project'))
  with check (public.project_has_permission(project_settings.project_id, auth.uid(), 'manage_project'));

notify pgrst, 'reload schema';
