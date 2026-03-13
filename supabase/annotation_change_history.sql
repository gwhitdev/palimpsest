-- Track per-annotation code revisions so UI can show what changed over time.

create extension if not exists "uuid-ossp";

create table if not exists public.annotation_change_history (
  id uuid primary key default uuid_generate_v4(),
  annotation_id uuid not null references public.annotations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  changed_by uuid not null references auth.users(id) on delete cascade,
  changed_by_name text not null,
  previous_tech_id text not null,
  next_tech_id text not null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_annotation_change_history_annotation
  on public.annotation_change_history(annotation_id, changed_at desc);

create index if not exists idx_annotation_change_history_document
  on public.annotation_change_history(project_id, document_id, changed_at desc);

alter table public.annotation_change_history enable row level security;

drop policy if exists "Members can read annotation change history" on public.annotation_change_history;
create policy "Members can read annotation change history"
  on public.annotation_change_history for select to authenticated
  using (
    public.can_access_document(annotation_change_history.project_id, auth.uid(), annotation_change_history.document_id)
  );

drop policy if exists "Coders can insert own annotation change history" on public.annotation_change_history;
create policy "Coders can insert own annotation change history"
  on public.annotation_change_history for insert to authenticated
  with check (
    changed_by = auth.uid()
    and public.project_has_permission(annotation_change_history.project_id, auth.uid(), 'annotate')
    and public.can_access_document(annotation_change_history.project_id, auth.uid(), annotation_change_history.document_id)
  );

notify pgrst, 'reload schema';
