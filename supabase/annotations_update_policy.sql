-- Enable annotation edits under the same project/document permission model.
-- This migration is needed if PATCH /api/annotate returns update-policy errors.

create extension if not exists "uuid-ossp";

drop policy if exists "Coders can update own annotations" on public.annotations;
create policy "Coders can update own annotations"
  on public.annotations for update to authenticated
  using (
    (
      coder_id = auth.uid()
      and public.project_has_permission(annotations.project_id, auth.uid(), 'annotate')
      and public.can_access_document(annotations.project_id, auth.uid(), annotations.document_id)
    )
    or public.project_has_permission(annotations.project_id, auth.uid(), 'manage_documents')
  )
  with check (
    (
      coder_id = auth.uid()
      and public.project_has_permission(annotations.project_id, auth.uid(), 'annotate')
      and public.can_access_document(annotations.project_id, auth.uid(), annotations.document_id)
    )
    or public.project_has_permission(annotations.project_id, auth.uid(), 'manage_documents')
  );

notify pgrst, 'reload schema';
