-- Shared, project-scoped research checklist state.
-- Prerequisite: run supabase/base_schema.sql and supabase/project_multitenancy_migration.sql.

create table if not exists public.project_research_checklists (
  project_id uuid primary key references public.projects(id) on delete cascade,
  checked jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.project_research_checklists enable row level security;

drop policy if exists "Members can read research checklist" on public.project_research_checklists;
create policy "Members can read research checklist"
  on public.project_research_checklists for select to authenticated
  using (public.project_has_permission(project_research_checklists.project_id, auth.uid(), 'view_documents'));

drop policy if exists "Annotators can edit research checklist" on public.project_research_checklists;
create policy "Annotators can edit research checklist"
  on public.project_research_checklists for insert to authenticated
  with check (public.project_has_permission(project_research_checklists.project_id, auth.uid(), 'annotate'));

drop policy if exists "Annotators can update research checklist" on public.project_research_checklists;
create policy "Annotators can update research checklist"
  on public.project_research_checklists for update to authenticated
  using (public.project_has_permission(project_research_checklists.project_id, auth.uid(), 'annotate'))
  with check (public.project_has_permission(project_research_checklists.project_id, auth.uid(), 'annotate'));

drop policy if exists "Owners can delete research checklist" on public.project_research_checklists;
create policy "Owners can delete research checklist"
  on public.project_research_checklists for delete to authenticated
  using (public.project_has_permission(project_research_checklists.project_id, auth.uid(), 'manage_project'));

notify pgrst, 'reload schema';
