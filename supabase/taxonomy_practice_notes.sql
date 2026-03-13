-- Editable per-project practical guidance for taxonomy codes.
-- Editable by project owners and app super admins (coders.role = 'admin').

create extension if not exists "uuid-ossp";

create table if not exists public.taxonomy_practice_notes (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tech_id text not null,
  practice_note text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(project_id, tech_id)
);

create index if not exists idx_taxonomy_practice_notes_project
  on public.taxonomy_practice_notes(project_id, tech_id);

alter table public.taxonomy_practice_notes enable row level security;

drop policy if exists "Project members can read taxonomy practice notes" on public.taxonomy_practice_notes;
create policy "Project members can read taxonomy practice notes"
  on public.taxonomy_practice_notes for select to authenticated
  using (
    exists (
      select 1
      from public.project_memberships pm
      where pm.project_id = taxonomy_practice_notes.project_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
    or exists (
      select 1
      from public.coders c
      where c.id = auth.uid()
        and c.role = 'admin'
    )
  );

drop policy if exists "Owners and admins can upsert taxonomy practice notes" on public.taxonomy_practice_notes;
create policy "Owners and admins can upsert taxonomy practice notes"
  on public.taxonomy_practice_notes for insert to authenticated
  with check (
    exists (
      select 1
      from public.project_memberships pm
      where pm.project_id = taxonomy_practice_notes.project_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'owner'
    )
    or exists (
      select 1
      from public.coders c
      where c.id = auth.uid()
        and c.role = 'admin'
    )
  );

drop policy if exists "Owners and admins can update taxonomy practice notes" on public.taxonomy_practice_notes;
create policy "Owners and admins can update taxonomy practice notes"
  on public.taxonomy_practice_notes for update to authenticated
  using (
    exists (
      select 1
      from public.project_memberships pm
      where pm.project_id = taxonomy_practice_notes.project_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'owner'
    )
    or exists (
      select 1
      from public.coders c
      where c.id = auth.uid()
        and c.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.project_memberships pm
      where pm.project_id = taxonomy_practice_notes.project_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'owner'
    )
    or exists (
      select 1
      from public.coders c
      where c.id = auth.uid()
        and c.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
