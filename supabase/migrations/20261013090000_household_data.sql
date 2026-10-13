-- Shared Mealio data model for Supabase.
-- This migration creates schema only; it does not provision a Supabase project,
-- enable an auth provider, or place credentials in the client.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

-- RLS policies call these narrowly scoped helpers to avoid recursive reads of
-- household_members from that table's own policies. The functions reveal only
-- membership booleans and always evaluate against the caller's auth.uid().
create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_admin(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'admin'
  );
$$;

revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.is_household_admin(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_admin(uuid) to authenticated;

-- Create the household and its initial administrator atomically. There is no
-- client policy for adding arbitrary users to a household; invitation flows
-- should later use a server-side function after explicit product/security work.
create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
  cleaned_name text := btrim(household_name);
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if exists (select 1 from public.household_members hm where hm.user_id = caller_id) then
    raise exception 'User already belongs to a household';
  end if;

  if cleaned_name is null or char_length(cleaned_name) not between 1 and 100 then
    raise exception 'Household name must be between 1 and 100 characters';
  end if;

  insert into public.households (name, created_by)
  values (cleaned_name, caller_id)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, caller_id, 'admin');

  return new_household_id;
end;
$$;

revoke all on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  normalized_name text not null check (char_length(normalized_name) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, normalized_name)
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_name text not null check (char_length(normalized_name) between 1 and 160),
  instructions text not null default '' check (char_length(instructions) <= 20000),
  photo_path text,
  source_local_id text check (source_local_id is null or char_length(source_local_id) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, source_local_id),
  check (photo_path is null or photo_path like household_id::text || '/' || id::text || '/%')
);

create table public.meal_ingredients (
  household_id uuid not null,
  meal_id uuid not null,
  ingredient_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (household_id, meal_id, ingredient_id),
  foreign key (household_id, meal_id)
    references public.meals (household_id, id) on delete cascade,
  foreign key (household_id, ingredient_id)
    references public.ingredients (household_id, id) on delete cascade
);

-- These RPCs keep meal + ingredient-link updates atomic even though the static
-- client uses PostgREST. Every function checks household membership explicitly.
create or replace function public.add_household_ingredient(
  target_household_id uuid, ingredient_name text, ingredient_normalized_name text
)
returns public.ingredients
language plpgsql
security definer
set search_path = ''
as $$
declare result public.ingredients;
begin
  if not public.is_household_member(target_household_id) then
    raise exception 'Household access denied';
  end if;
  insert into public.ingredients (household_id, name, normalized_name)
  values (target_household_id, btrim(ingredient_name), ingredient_normalized_name)
  on conflict (household_id, normalized_name) do update
    set normalized_name = excluded.normalized_name
  returning * into result;
  return result;
end;
$$;

create or replace function public.save_household_meal(
  target_household_id uuid, target_meal_id uuid, meal_name text,
  meal_normalized_name text, meal_instructions text, ingredient_ids uuid[], target_photo_path text,
  target_source_local_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id uuid;
begin
  if not public.is_household_member(target_household_id) then
    raise exception 'Household access denied';
  end if;
  if target_source_local_id is not null then
    select id into saved_id from public.meals
      where household_id = target_household_id and source_local_id = target_source_local_id;
  end if;
  saved_id := coalesce(saved_id, target_meal_id, gen_random_uuid());
  if cardinality(ingredient_ids) is null or cardinality(ingredient_ids) = 0 then
    raise exception 'A meal must have at least one ingredient';
  end if;
  if target_photo_path is not null
    and target_photo_path not like target_household_id::text || '/' || saved_id::text || '/%' then
    raise exception 'Photo path does not belong to this meal';
  end if;

  insert into public.meals (id, household_id, name, normalized_name, instructions, photo_path, source_local_id)
  values (saved_id, target_household_id, btrim(meal_name), meal_normalized_name,
    coalesce(meal_instructions, ''), target_photo_path, target_source_local_id)
  on conflict (id) do update set
    name = excluded.name,
    normalized_name = excluded.normalized_name,
    instructions = excluded.instructions,
    photo_path = excluded.photo_path,
    source_local_id = coalesce(excluded.source_local_id, public.meals.source_local_id),
    updated_at = now()
  where public.meals.household_id = target_household_id;

  if not found then raise exception 'Meal does not exist in this household'; end if;

  delete from public.meal_ingredients
    where household_id = target_household_id and meal_id = saved_id;
  insert into public.meal_ingredients (household_id, meal_id, ingredient_id)
  select target_household_id, saved_id, selected.ingredient_id
    from unnest(ingredient_ids) as selected(ingredient_id)
    where exists (
      select 1 from public.ingredients i
      where i.id = selected.ingredient_id and i.household_id = target_household_id
    )
  on conflict do nothing;
  if (select count(*) from public.meal_ingredients
      where household_id = target_household_id and meal_id = saved_id)
      <> (select count(distinct selected.value) from unnest(ingredient_ids) as selected(value)) then
    raise exception 'Every selected ingredient must belong to this household';
  end if;
  return saved_id;
end;
$$;

create or replace function public.delete_household_meal(target_household_id uuid, target_meal_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare previous_photo text;
begin
  if not public.is_household_member(target_household_id) then
    raise exception 'Household access denied';
  end if;
  select photo_path into previous_photo from public.meals
   where id = target_meal_id and household_id = target_household_id;
  if not found then raise exception 'Meal does not exist in this household'; end if;
  delete from public.meals where id = target_meal_id and household_id = target_household_id;
  return previous_photo;
end;
$$;

revoke all on function public.add_household_ingredient(uuid, text, text) from public, anon;
revoke all on function public.save_household_meal(uuid, uuid, text, text, text, uuid[], text, text) from public, anon;
revoke all on function public.delete_household_meal(uuid, uuid) from public, anon;
grant execute on function public.add_household_ingredient(uuid, text, text) to authenticated;
grant execute on function public.save_household_meal(uuid, uuid, text, text, text, uuid[], text, text) to authenticated;
grant execute on function public.delete_household_meal(uuid, uuid) to authenticated;

-- The invitation Edge Function uses this service-role-only lookup to reject an
-- address already tied to another household before it sends an email.
create or replace function public.lookup_auth_user_id_by_email(target_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(target_email)) limit 1;
$$;
revoke all on function public.lookup_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_user_id_by_email(text) to service_role;

create index meals_household_updated_at_idx on public.meals (household_id, updated_at desc);
create index meal_ingredients_ingredient_idx on public.meal_ingredients (household_id, ingredient_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.ingredients enable row level security;
alter table public.meals enable row level security;
alter table public.meal_ingredients enable row level security;

-- Restrict the browser roles to the minimum table operations needed by the app.
revoke all on public.households, public.household_members, public.ingredients,
  public.meals, public.meal_ingredients from anon, authenticated;
grant select on public.households, public.household_members to authenticated;
-- Client writes go through the membership-checking RPCs above so meals cannot
-- be left without links and creator attribution cannot be rewritten directly.
grant select on public.ingredients, public.meals, public.meal_ingredients to authenticated;

create policy "Members can read their households"
  on public.households for select to authenticated
  using (public.is_household_member(id));

create policy "Members can read household membership"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

create policy "Members can read household ingredients"
  on public.ingredients for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add household ingredients"
  on public.ingredients for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and created_by = (select auth.uid())
  );
create policy "Members can edit household ingredients"
  on public.ingredients for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "Members can remove household ingredients"
  on public.ingredients for delete to authenticated
  using (public.is_household_member(household_id));

create policy "Members can read household meals"
  on public.meals for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add household meals"
  on public.meals for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and created_by = (select auth.uid())
  );
create policy "Members can edit household meals"
  on public.meals for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "Members can remove household meals"
  on public.meals for delete to authenticated
  using (public.is_household_member(household_id));

create policy "Members can read meal ingredients"
  on public.meal_ingredients for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add meal ingredients"
  on public.meal_ingredients for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "Members can remove meal ingredients"
  on public.meal_ingredients for delete to authenticated
  using (public.is_household_member(household_id));

-- Private object storage. The first folder in every object path is the
-- household UUID; expected keys are {household_id}/{meal_id}/{filename}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos',
  'meal-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Members can read household meal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );
create policy "Members can upload household meal photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2]) is not null
    and ((storage.foldername(name))[3]) is not null
  );
create policy "Members can update household meal photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'meal-photos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'meal-photos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[2]) is not null
    and ((storage.foldername(name))[3]) is not null
  );
create policy "Members can remove household meal photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );
