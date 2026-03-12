-- Hotfix for: infinite recursion detected in policy for relation "project_memberships"
-- Run in Supabase SQL editor on existing databases.

-- Replace recursive policy with a non-recursive predicate.
drop policy if exists "Members can read project memberships" on public.project_memberships;
create policy "Members can read project memberships"
  on public.project_memberships for select to authenticated
  using (
    project_memberships.user_id = auth.uid()
    or public.project_has_permission(project_memberships.project_id, auth.uid(), 'manage_members')
  );

-- Avoid recursive join back into project_memberships for permissions visibility.
drop policy if exists "Members can read permission overrides" on public.project_member_permissions;
create policy "Members can read permission overrides"
  on public.project_member_permissions for select to authenticated
  using (public.project_has_permission(project_member_permissions.project_id, auth.uid(), 'view_documents'));

notify pgrst, 'reload schema';
