-- Restrict coder document visibility to owner-assigned documents.
-- Owners (or users with manage_documents) still see all documents in the project.

create or replace function public.can_access_document(
  target_project uuid,
  target_user uuid,
  target_document uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_role text;
  can_view boolean;
  has_assignment boolean;
begin
  if target_project is null or target_user is null or target_document is null then
    return false;
  end if;

  select pm.role
  into member_role
  from public.project_memberships pm
  where pm.project_id = target_project
    and pm.user_id = target_user
    and pm.status = 'active';

  if member_role is null then
    return false;
  end if;

  can_view := public.project_has_permission(target_project, target_user, 'view_documents');
  if not can_view then
    return false;
  end if;

  if member_role = 'owner' then
    return true;
  end if;

  if public.project_has_permission(target_project, target_user, 'manage_documents') then
    return true;
  end if;

  begin
    execute $sql$
      select exists (
        select 1
        from public.document_assignments da
        where da.project_id = $1
          and da.document_id = $2
          and da.coder_id = $3
      )
    $sql$
    into has_assignment
    using target_project, target_document, target_user;
  exception
    when undefined_table then
      return false;
  end;

  return coalesce(has_assignment, false);
end
$$;

grant execute on function public.can_access_document(uuid, uuid, uuid) to authenticated;

drop policy if exists "Members can read documents" on public.documents;
create policy "Members can read documents"
  on public.documents for select to authenticated
  using (public.can_access_document(documents.project_id, auth.uid(), documents.id));

drop policy if exists "Members can read annotations" on public.annotations;
create policy "Members can read annotations"
  on public.annotations for select to authenticated
  using (public.can_access_document(annotations.project_id, auth.uid(), annotations.document_id));

drop policy if exists "Coders can insert own annotations" on public.annotations;
create policy "Coders can insert own annotations"
  on public.annotations for insert to authenticated
  with check (
    public.project_has_permission(annotations.project_id, auth.uid(), 'annotate')
    and public.can_access_document(annotations.project_id, auth.uid(), annotations.document_id)
    and coder_id = auth.uid()
  );

drop policy if exists "Coders can delete own annotations" on public.annotations;
create policy "Coders can delete own annotations"
  on public.annotations for delete to authenticated
  using (
    (
      coder_id = auth.uid()
      and public.project_has_permission(annotations.project_id, auth.uid(), 'annotate')
      and public.can_access_document(annotations.project_id, auth.uid(), annotations.document_id)
    )
    or public.project_has_permission(annotations.project_id, auth.uid(), 'manage_documents')
  );

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';
