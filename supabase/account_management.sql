-- Account self-service: allow authenticated users to close their own account.

create or replace function public.close_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Unauthorised';
  end if;

  delete from auth.users
  where id = current_user_id;
end
$$;

grant execute on function public.close_own_account() to authenticated;
