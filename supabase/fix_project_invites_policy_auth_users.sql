-- Hotfix for: permission denied for table users when reading/opening projects.
-- Root cause: RLS policy on project_invites selected from auth.users.

alter table public.project_invites enable row level security;

drop policy if exists "Members can read project invites" on public.project_invites;
create policy "Members can read project invites"
  on public.project_invites for select to authenticated
  using (
    public.project_has_permission(project_invites.project_id, auth.uid(), 'invite_members')
    or lower(project_invites.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

notify pgrst, 'reload schema';
