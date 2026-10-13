-- One-use, short-lived household invite codes. Raw codes never enter the
-- database: only a SHA-256 hash is stored. All lookup/consume operations run
-- through narrowly granted RPCs or the authenticated Edge Functions.

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  check (expires_at > created_at),
  -- Account deletion may null the audit reference after a successful redeem.
  check (redeemed_at is not null or redeemed_by is null)
);

create index household_invites_household_created_idx
  on public.household_invites (household_id, created_at desc);

alter table public.household_invites enable row level security;
revoke all on public.household_invites from public, anon, authenticated, service_role;
-- No table policies are intentional: invite metadata and hashes are accessed
-- only inside the security-definer RPCs below, never through PostgREST tables.

create or replace function public.create_household_invite(
  target_household_id uuid,
  target_creator_id uuid,
  invite_label text,
  token_hash_hex text,
  valid_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_invite_id uuid;
  new_expiration timestamptz;
  cleaned_label text := btrim(invite_label);
begin
  if target_creator_id is null or not exists (
    select 1 from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = target_creator_id
      and hm.role = 'admin'
  ) then
    raise exception 'Only a household administrator can create invites';
  end if;
  if cleaned_label is null or char_length(cleaned_label) not between 1 and 80 then
    raise exception 'Invite label must be between 1 and 80 characters';
  end if;
  if valid_days not between 1 and 30 then
    raise exception 'Invite validity must be between 1 and 30 days';
  end if;
  if token_hash_hex is null or token_hash_hex !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Invalid invite token hash';
  end if;

  new_expiration := now() + make_interval(days => valid_days);
  insert into public.household_invites (
    household_id, label, token_hash, created_by, expires_at
  ) values (
    target_household_id, cleaned_label, decode(token_hash_hex, 'hex'),
    target_creator_id, new_expiration
  ) returning id into new_invite_id;

  return jsonb_build_object('invite_id', new_invite_id, 'expires_at', new_expiration);
end;
$$;

revoke all on function public.create_household_invite(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_household_invite(uuid, uuid, text, text, integer) to service_role;
comment on function public.create_household_invite(uuid, uuid, text, text, integer)
  is 'Service-role-only RPC called by the authenticated create-household-invite Edge Function. Stores only a SHA-256 token hash.';

-- Redeem is atomic: the row lock prevents two callers from consuming the same
-- code, and the unique household_members.user_id constraint preserves the
-- one-household-per-user rule. Repeating a successful redemption by the same
-- user returns the same household (safe retry behavior).
create or replace function public.redeem_household_invite(
  token_hash_hex text,
  target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.household_invites%rowtype;
  member_household_id uuid;
  member_household_name text;
begin
  if target_user_id is null then
    raise exception 'Authenticated user required';
  end if;
  if token_hash_hex is null or token_hash_hex !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Invalid or expired invite code';
  end if;

  select * into invitation
    from public.household_invites hi
    where hi.token_hash = decode(token_hash_hex, 'hex')
    for update;
  if not found then raise exception 'Invalid or expired invite code'; end if;

  if invitation.redeemed_at is not null then
    if invitation.redeemed_by = target_user_id and exists (
      select 1 from public.household_members hm
      where hm.household_id = invitation.household_id and hm.user_id = target_user_id
    ) then
      return jsonb_build_object(
        'household_id', invitation.household_id,
        'household_name', (select h.name from public.households h where h.id = invitation.household_id)
      );
    end if;
    raise exception 'Invalid or expired invite code';
  end if;
  if invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception 'Invalid or expired invite code';
  end if;

  select hm.household_id into member_household_id
    from public.household_members hm where hm.user_id = target_user_id;
  if member_household_id is not null and member_household_id <> invitation.household_id then
    raise exception 'User already belongs to another household';
  end if;
  if member_household_id is null then
    insert into public.household_members (household_id, user_id, role)
      values (invitation.household_id, target_user_id, 'member');
  end if;

  update public.household_invites
    set redeemed_at = now(), redeemed_by = target_user_id
    where id = invitation.id;
  select h.name into member_household_name
    from public.households h where h.id = invitation.household_id;
  return jsonb_build_object(
    'household_id', invitation.household_id,
    'household_name', member_household_name
  );
end;
$$;

revoke all on function public.redeem_household_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_household_invite(text, uuid) to service_role;
comment on function public.redeem_household_invite(text, uuid)
  is 'Service-role-only RPC called by the authenticated redeem-household-invite Edge Function; atomically consumes a one-use invite.';

-- Administrators can revoke an invite without exposing the invite table. A
-- redeemed invite cannot be revoked retroactively; removal is a separate flow.
create or replace function public.revoke_household_invite(target_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household_id uuid;
begin
  select hi.household_id into target_household_id
    from public.household_invites hi where hi.id = target_invite_id;
  if target_household_id is null then return false; end if;
  if not public.is_household_admin(target_household_id) then
    raise exception 'Only a household administrator can revoke invites';
  end if;
  update public.household_invites
    set revoked_at = coalesce(revoked_at, now())
    where id = target_invite_id and redeemed_at is null;
  return found;
end;
$$;

revoke all on function public.revoke_household_invite(uuid) from public, anon;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
comment on function public.revoke_household_invite(uuid)
  is 'Allows an authenticated household administrator to revoke an unused invite code.';
