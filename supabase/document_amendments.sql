-- Add document amendment metadata for owner-edited content notices.

alter table if exists public.documents
  add column if not exists amended_at timestamptz,
  add column if not exists amended_by uuid references auth.users(id) on delete set null,
  add column if not exists amendment_note text;

notify pgrst, 'reload schema';
