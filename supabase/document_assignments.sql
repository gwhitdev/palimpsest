-- Create coder assignment table for admin workflow
-- Prerequisite: run supabase/base_schema.sql first.
do $$
begin
  if to_regclass('public.projects') is null then
    raise exception 'Missing table public.projects. Run supabase/base_schema.sql first.';
  end if;

  if to_regclass('public.documents') is null then
    raise exception 'Missing table public.documents. Run supabase/base_schema.sql first.';
  end if;

  if to_regclass('public.coders') is null then
    raise exception 'Missing table public.coders. Run supabase/base_schema.sql first.';
  end if;
end
$$;

create table if not exists public.document_assignments (
  project_id  uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  coder_id    uuid not null references public.coders(id) on delete cascade,
  assigned_at timestamptz default now(),
  primary key (project_id, document_id, coder_id)
);

alter table public.document_assignments enable row level security;

drop policy if exists "Authenticated users can read assignments"
  on public.document_assignments;

create policy "Authenticated users can read assignments"
  on public.document_assignments for select to authenticated
  using (public.project_has_permission(document_assignments.project_id, auth.uid(), 'view_documents'));

drop policy if exists "Admins can manage assignments"
  on public.document_assignments;

create policy "Admins can manage assignments"
  on public.document_assignments for all to authenticated
  using (public.project_has_permission(document_assignments.project_id, auth.uid(), 'manage_members'))
  with check (public.project_has_permission(document_assignments.project_id, auth.uid(), 'manage_members'));

do $$
begin
  alter publication supabase_realtime add table public.document_assignments;
exception
  when duplicate_object then
    null;
end
$$;
