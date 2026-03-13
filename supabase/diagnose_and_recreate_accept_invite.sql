-- Diagnose target database and recreate invite-accept function safely.
-- Run this in the SAME Supabase project your app is using.

-- 1) Sanity checks: fail fast if this is the wrong database.
do $$
begin
  if to_regclass('public.project_invites') is null then
    raise exception 'Missing public.project_invites. You are likely connected to the wrong database/project.';
  end if;

  if to_regclass('public.project_memberships') is null then
    raise exception 'Missing public.project_memberships. You are likely connected to the wrong database/project.';
  end if;

  if to_regclass('public.project_member_permissions') is null then
    raise exception 'Missing public.project_member_permissions. You are likely connected to the wrong database/project.';
  end if;
end
$$;

begin;

drop function if exists public.accept_project_invite(uuid);

create function public.accept_project_invite(invite_token uuid)
returns table(invited_project_id uuid, invited_role text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_user_id uuid;
  current_user_email text;
  invite_record public.project_invites%rowtype;
  permission_name text;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Unauthorised';
  end if;

  select users.email
  into current_user_email
  from auth.users as users
  where users.id = current_user_id;

  if current_user_email is null then
    raise exception 'Could not resolve current user email.';
  end if;

  select invites.*
  into invite_record
  from public.project_invites as invites
  where invites.token = invite_token
    and invites.status = 'pending'
    and invites.expires_at > now();

  if invite_record.id is null then
    raise exception 'Invite token is invalid or expired.';
  end if;

  if lower(invite_record.email) <> lower(current_user_email) then
    raise exception 'Invite email does not match your signed-in account.';
  end if;

  insert into public.project_memberships (project_id, user_id, role, status, invited_by)
  values (invite_record.project_id, current_user_id, invite_record.role, 'active', invite_record.invited_by)
  on conflict (project_id, user_id)
  do update
    set role = excluded.role,
        status = 'active',
        invited_by = excluded.invited_by;

  delete from public.project_member_permissions as permissions
  where permissions.project_id = invite_record.project_id
    and permissions.user_id = current_user_id;

  foreach permission_name in array invite_record.grant_permissions loop
    if permission_name is not null and permission_name <> '' then
      insert into public.project_member_permissions (project_id, user_id, permission, effect, created_by)
      values (invite_record.project_id, current_user_id, permission_name, 'allow', invite_record.invited_by)
      on conflict (project_id, user_id, permission)
      do update set effect = excluded.effect, created_by = excluded.created_by;
    end if;
  end loop;

  foreach permission_name in array invite_record.deny_permissions loop
    if permission_name is not null and permission_name <> '' then
      insert into public.project_member_permissions (project_id, user_id, permission, effect, created_by)
      values (invite_record.project_id, current_user_id, permission_name, 'deny', invite_record.invited_by)
      on conflict (project_id, user_id, permission)
      do update set effect = excluded.effect, created_by = excluded.created_by;
    end if;
  end loop;

  update public.project_invites
  set status = 'accepted',
      accepted_by = current_user_id
  where id = invite_record.id;

  invited_project_id := invite_record.project_id;
  invited_role := invite_record.role;
  return next;
  return;
end
$$;

grant execute on function public.accept_project_invite(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- 2) Hard assertion: fail if function was not recreated with the safe output names.
do $$
declare
  actual_signature text;
begin
  select pg_get_function_result(p.oid)
  into actual_signature
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'accept_project_invite'
    and pg_get_function_identity_arguments(p.oid) = 'invite_token uuid';

  if actual_signature is distinct from 'TABLE(invited_project_id uuid, invited_role text)' then
    raise exception 'accept_project_invite has unexpected result signature: %', coalesce(actual_signature, '<missing>');
  end if;
end
$$;

-- 3) Verification output.
select
  p.oid::regprocedure as function_signature,
  pg_get_function_result(p.oid) as result_signature
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'accept_project_invite';
