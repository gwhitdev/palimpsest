-- Migrate an existing Palimpsest database to project-scoped multitenancy + RBAC.
-- Run AFTER supabase/base_schema.sql.

create extension if not exists "uuid-ossp";

-- Ensure project tables exist even in older environments.
create table if not exists public.projects (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

create table if not exists public.project_memberships (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'coder')),
  status      text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  invited_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_member_permissions (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  permission  text not null,
  effect      text not null check (effect in ('allow', 'deny')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  primary key (project_id, user_id, permission)
);

create table if not exists public.project_invites (
  id                  uuid primary key default uuid_generate_v4(),
  token               uuid unique not null default uuid_generate_v4(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  email               text not null,
  role                text not null check (role in ('owner', 'coder')),
  grant_permissions   text[] not null default '{}',
  deny_permissions    text[] not null default '{}',
  invited_by          uuid references auth.users(id),
  accepted_by         uuid references auth.users(id),
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at          timestamptz not null default (now() + interval '14 days'),
  created_at          timestamptz default now()
);

-- Make sure every user has a profile.
insert into public.coders (id, display_name)
select
  users.id,
  coalesce(users.raw_user_meta_data->>'display_name', split_part(users.email, '@', 1), 'Coder')
from auth.users as users
left join public.coders as coders
  on coders.id = users.id
where coders.id is null;

-- Ensure every user has at least one owned project.
insert into public.projects (name, created_by)
select
  coalesce(users.raw_user_meta_data->>'display_name', split_part(users.email, '@', 1), 'Coder') || '''s Project',
  users.id
from auth.users as users
where not exists (
  select 1
  from public.project_memberships pm
  where pm.user_id = users.id
    and pm.role = 'owner'
    and pm.status = 'active'
);

insert into public.project_memberships (project_id, user_id, role, status, invited_by)
select
  projects.id,
  projects.created_by,
  'owner',
  'active',
  projects.created_by
from public.projects
left join public.project_memberships pm
  on pm.project_id = projects.id
 and pm.user_id = projects.created_by
where projects.created_by is not null
  and pm.project_id is null;

alter table if exists public.documents add column if not exists project_id uuid;
alter table if exists public.annotations add column if not exists project_id uuid;
alter table if exists public.document_assignments add column if not exists project_id uuid;

-- Backfill project_id on documents from creator membership.
update public.documents d
set project_id = pm.project_id
from public.project_memberships pm
where d.project_id is null
  and d.created_by = pm.user_id
  and pm.status = 'active'
  and pm.role = 'owner';

-- Backfill remaining documents from first active owner project if creator missing.
with fallback as (
  select pm.project_id
  from public.project_memberships pm
  where pm.role = 'owner'
    and pm.status = 'active'
  order by pm.created_at asc
  limit 1
)
update public.documents d
set project_id = fallback.project_id
from fallback
where d.project_id is null;

-- Backfill annotations from their document.
update public.annotations a
set project_id = d.project_id
from public.documents d
where a.project_id is null
  and a.document_id = d.id;

-- Backfill remaining annotations from coder active project.
update public.annotations a
set project_id = pm.project_id
from (
  select distinct on (memberships.user_id)
    memberships.user_id,
    memberships.project_id
  from public.project_memberships as memberships
  where memberships.status = 'active'
  order by memberships.user_id, memberships.created_at asc
) as pm
where a.project_id is null
  and a.coder_id = pm.user_id;

-- Backfill assignments from documents.
update public.document_assignments da
set project_id = d.project_id
from public.documents d
where da.project_id is null
  and da.document_id = d.id;

-- Apply not-null once data is backfilled.
alter table public.documents alter column project_id set not null;
alter table public.annotations alter column project_id set not null;
alter table public.document_assignments alter column project_id set not null;

-- Add project foreign keys if missing.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_project_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'annotations_project_id_fkey'
  ) then
    alter table public.annotations
      add constraint annotations_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_assignments_project_id_fkey'
  ) then
    alter table public.document_assignments
      add constraint document_assignments_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;
end
$$;

create index if not exists idx_documents_project_id on public.documents(project_id);
create index if not exists idx_annotations_project_id on public.annotations(project_id);
create index if not exists idx_assignments_project_id on public.document_assignments(project_id);
create index if not exists idx_project_memberships_user on public.project_memberships(user_id);

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

drop function if exists public.project_has_permission(text, uuid, uuid);

grant execute on function public.project_has_permission(uuid, uuid, text) to authenticated;
grant execute on function public.role_has_permission(text, text) to authenticated;

create or replace function public.accept_project_invite(invite_token uuid)
returns table(project_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
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

  delete from public.project_member_permissions
  where project_id = invite_record.project_id
    and user_id = current_user_id;

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

  return query select invite_record.project_id, invite_record.role;
end
$$;

grant execute on function public.accept_project_invite(uuid) to authenticated;
