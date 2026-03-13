-- Add owner-curated merged annotation set.
-- Prerequisite: run supabase/base_schema.sql and supabase/document_assignments.sql.

create extension if not exists "uuid-ossp";

drop table if exists public.annotation_votes cascade;

create table if not exists public.merged_annotations (
  annotation_id uuid primary key references public.annotations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  selected_by   uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz default now()
);

create index if not exists idx_merged_annotations_doc
  on public.merged_annotations(project_id, document_id);

alter table public.merged_annotations enable row level security;

drop policy if exists "Members can read merged annotations" on public.merged_annotations;
create policy "Members can read merged annotations"
  on public.merged_annotations for select to authenticated
  using (public.can_access_document(merged_annotations.project_id, auth.uid(), merged_annotations.document_id));

drop policy if exists "Managers can manage merged annotations" on public.merged_annotations;
create policy "Managers can manage merged annotations"
  on public.merged_annotations for all to authenticated
  using (public.project_has_permission(merged_annotations.project_id, auth.uid(), 'manage_documents'))
  with check (public.project_has_permission(merged_annotations.project_id, auth.uid(), 'manage_documents'));

do $$
begin
  alter publication supabase_realtime add table public.merged_annotations;
exception
  when duplicate_object then
    null;
end
$$;

notify pgrst, 'reload schema';
