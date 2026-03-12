-- Hotfix for dashboard error:
-- Could not find the function public.project_has_permission(requested_permission, target_project, target_user)
--
-- Run this in Supabase SQL editor, then refresh the app.

-- Remove ambiguous overload first.
drop function if exists public.project_has_permission(text, uuid, uuid);

create or replace function public.role_has_permission(member_role text, requested_permission text)
returns boolean
language sql
stable
as $$
  select case
    when member_role = 'owner' then true
    when member_role = 'coder' then requested_permission in (
      'view_documents',
      'annotate',
      'view_stats',
      'export_data'
    )
    else false
  end;
$$;

create or replace function public.project_has_permission(target_project uuid, target_user uuid, requested_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_role text;
  override_effect text;
begin
  select pm.role
  into member_role
  from public.project_memberships pm
  where pm.project_id = target_project
    and pm.user_id = target_user
    and pm.status = 'active';

  if member_role is null then
    return false;
  end if;

  select pmp.effect
  into override_effect
  from public.project_member_permissions pmp
  where pmp.project_id = target_project
    and pmp.user_id = target_user
    and pmp.permission = requested_permission;

  if override_effect = 'deny' then
    return false;
  end if;

  if override_effect = 'allow' then
    return true;
  end if;

  return public.role_has_permission(member_role, requested_permission);
end
$$;

grant execute on function public.project_has_permission(uuid, uuid, text) to authenticated;
grant execute on function public.role_has_permission(text, text) to authenticated;

-- Ask PostgREST to refresh cached schema signatures.
notify pgrst, 'reload schema';
