-- Core Palimpsest schema with project-scoped multitenancy and RBAC+discretion permissions.
create extension if not exists "uuid-ossp";

create table if not exists public.coders (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz default now()
);

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

create table if not exists public.documents (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  source      text,
  content     text not null,
  created_at  timestamptz default now(),
  created_by  uuid references auth.users(id)
);

create table if not exists public.annotations (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  document_id  uuid references public.documents(id) on delete cascade,
  coder_id     uuid references auth.users(id),
  coder_name   text not null,
  tech_id      text not null,
  quoted_text  text not null,
  start_offset integer,
  end_offset   integer,
  is_ai        boolean default false,
  accepted     boolean default true,
  created_at   timestamptz default now()
);

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

-- Compatibility overload for environments where cached RPC signatures expect
-- requested_permission first (text, uuid, uuid).
create or replace function public.project_has_permission(requested_permission text, target_project uuid, target_user uuid)
returns boolean
language sql
stable
as $$
  select public.project_has_permission(target_project, target_user, requested_permission);
$$;

grant execute on function public.project_has_permission(uuid, uuid, text) to authenticated;
grant execute on function public.project_has_permission(text, uuid, uuid) to authenticated;

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

create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.project_memberships (project_id, user_id, role, status, invited_by)
    values (new.id, new.created_by, 'owner', 'active', new.created_by)
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_name text;
  personal_project_id uuid;
begin
  derived_name := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1),
    'Coder'
  );

  insert into public.coders (id, display_name)
  values (new.id, derived_name)
  on conflict (id) do nothing;

  insert into public.projects (name, created_by)
  values (derived_name || '''s Project', new.id)
  returning id into personal_project_id;

  insert into public.project_memberships (project_id, user_id, role, status, invited_by)
  values (personal_project_id, new.id, 'owner', 'active', new.id)
  on conflict (project_id, user_id) do nothing;

  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.coders (id, display_name)
select
  users.id,
  coalesce(users.raw_user_meta_data->>'display_name', split_part(users.email, '@', 1), 'Coder')
from auth.users as users
left join public.coders as profiles on profiles.id = users.id
where profiles.id is null;

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

alter table public.coders enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;
alter table public.project_member_permissions enable row level security;
alter table public.project_invites enable row level security;
alter table public.documents enable row level security;
alter table public.annotations enable row level security;

drop policy if exists "Authenticated users can read coders" on public.coders;
create policy "Authenticated users can read coders"
  on public.coders for select to authenticated using (true);

drop policy if exists "Users can insert own coder profile" on public.coders;
create policy "Users can insert own coder profile"
  on public.coders for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update own coder profile" on public.coders;
create policy "Users can update own coder profile"
  on public.coders for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "Members can read own projects" on public.projects;
create policy "Members can read own projects"
  on public.projects for select to authenticated
  using (
    exists (
      select 1
      from public.project_memberships pm
      where pm.project_id = projects.id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
  );

drop policy if exists "Users can create projects" on public.projects;
create policy "Users can create projects"
  on public.projects for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "Owners can update projects" on public.projects;
create policy "Owners can update projects"
  on public.projects for update to authenticated
  using (public.project_has_permission(projects.id, auth.uid(), 'manage_project'))
  with check (public.project_has_permission(projects.id, auth.uid(), 'manage_project'));

drop policy if exists "Members can read project memberships" on public.project_memberships;
create policy "Members can read project memberships"
  on public.project_memberships for select to authenticated
  using (
    exists (
      select 1
      from public.project_memberships viewer
      where viewer.project_id = project_memberships.project_id
        and viewer.user_id = auth.uid()
        and viewer.status = 'active'
    )
  );

drop policy if exists "Managers can change project memberships" on public.project_memberships;
create policy "Managers can change project memberships"
  on public.project_memberships for all to authenticated
  using (public.project_has_permission(project_memberships.project_id, auth.uid(), 'manage_members'))
  with check (public.project_has_permission(project_memberships.project_id, auth.uid(), 'manage_members'));

drop policy if exists "Members can read permission overrides" on public.project_member_permissions;
create policy "Members can read permission overrides"
  on public.project_member_permissions for select to authenticated
  using (
    exists (
      select 1
      from public.project_memberships viewer
      where viewer.project_id = project_member_permissions.project_id
        and viewer.user_id = auth.uid()
        and viewer.status = 'active'
    )
  );

drop policy if exists "Managers can change permission overrides" on public.project_member_permissions;
create policy "Managers can change permission overrides"
  on public.project_member_permissions for all to authenticated
  using (public.project_has_permission(project_member_permissions.project_id, auth.uid(), 'manage_permissions'))
  with check (public.project_has_permission(project_member_permissions.project_id, auth.uid(), 'manage_permissions'));

drop policy if exists "Members can read project invites" on public.project_invites;
create policy "Members can read project invites"
  on public.project_invites for select to authenticated
  using (
    public.project_has_permission(project_invites.project_id, auth.uid(), 'invite_members')
    or lower(project_invites.email) = lower((select email from auth.users where id = auth.uid()))
  );

drop policy if exists "Managers can create project invites" on public.project_invites;
create policy "Managers can create project invites"
  on public.project_invites for insert to authenticated
  with check (public.project_has_permission(project_invites.project_id, auth.uid(), 'invite_members'));

drop policy if exists "Managers can update project invites" on public.project_invites;
create policy "Managers can update project invites"
  on public.project_invites for update to authenticated
  using (public.project_has_permission(project_invites.project_id, auth.uid(), 'invite_members'))
  with check (public.project_has_permission(project_invites.project_id, auth.uid(), 'invite_members'));

drop policy if exists "Members can read documents" on public.documents;
create policy "Members can read documents"
  on public.documents for select to authenticated
  using (public.project_has_permission(documents.project_id, auth.uid(), 'view_documents'));

drop policy if exists "Managers can insert documents" on public.documents;
create policy "Managers can insert documents"
  on public.documents for insert to authenticated
  with check (
    public.project_has_permission(documents.project_id, auth.uid(), 'manage_documents')
    and created_by = auth.uid()
  );

drop policy if exists "Managers can update documents" on public.documents;
create policy "Managers can update documents"
  on public.documents for update to authenticated
  using (public.project_has_permission(documents.project_id, auth.uid(), 'manage_documents'))
  with check (public.project_has_permission(documents.project_id, auth.uid(), 'manage_documents'));

drop policy if exists "Managers can delete documents" on public.documents;
create policy "Managers can delete documents"
  on public.documents for delete to authenticated
  using (public.project_has_permission(documents.project_id, auth.uid(), 'manage_documents'));

drop policy if exists "Members can read annotations" on public.annotations;
create policy "Members can read annotations"
  on public.annotations for select to authenticated
  using (public.project_has_permission(annotations.project_id, auth.uid(), 'view_documents'));

drop policy if exists "Coders can insert own annotations" on public.annotations;
create policy "Coders can insert own annotations"
  on public.annotations for insert to authenticated
  with check (
    public.project_has_permission(annotations.project_id, auth.uid(), 'annotate')
    and coder_id = auth.uid()
  );

drop policy if exists "Coders can delete own annotations" on public.annotations;
create policy "Coders can delete own annotations"
  on public.annotations for delete to authenticated
  using (
    (coder_id = auth.uid() and public.project_has_permission(annotations.project_id, auth.uid(), 'annotate'))
    or public.project_has_permission(annotations.project_id, auth.uid(), 'manage_documents')
  );

do $$
begin
  alter publication supabase_realtime add table public.annotations;
exception
  when duplicate_object then
    null;
end
$$;
