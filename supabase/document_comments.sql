-- Create threaded document comments with quote anchors.
-- Prerequisite: run supabase/base_schema.sql and supabase/document_assignments.sql.

create extension if not exists "uuid-ossp";

create table if not exists public.document_comments (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  parent_id    uuid references public.document_comments(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  author_name  text not null,
  body         text not null,
  quoted_text  text,
  start_offset integer,
  end_offset   integer,
  created_at   timestamptz default now()
);

create index if not exists idx_document_comments_project_document
  on public.document_comments(project_id, document_id, created_at);

create index if not exists idx_document_comments_parent
  on public.document_comments(parent_id);

alter table public.document_comments enable row level security;

drop policy if exists "Members can read comments" on public.document_comments;
create policy "Members can read comments"
  on public.document_comments for select to authenticated
  using (public.can_access_document(document_comments.project_id, auth.uid(), document_comments.document_id));

drop policy if exists "Annotators can insert comments" on public.document_comments;
create policy "Annotators can insert comments"
  on public.document_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.project_has_permission(document_comments.project_id, auth.uid(), 'annotate')
    and public.can_access_document(document_comments.project_id, auth.uid(), document_comments.document_id)
  );

drop policy if exists "Authors or managers can delete comments" on public.document_comments;
create policy "Authors or managers can delete comments"
  on public.document_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or public.project_has_permission(document_comments.project_id, auth.uid(), 'manage_documents')
  );

do $$
begin
  alter publication supabase_realtime add table public.document_comments;
exception
  when duplicate_object then
    null;
end
$$;
