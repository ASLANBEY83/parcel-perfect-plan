create type public.app_role as enum ('admin', 'user');
create type public.approval_status as enum ('pending', 'approved', 'rejected');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Own roles readable" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create table public.profiles (
  id uuid primary key,
  email text,
  full_name text,
  avatar_url text,
  status public.approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create policy "Own or admin read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Admin update" on public.profiles for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_admin boolean := lower(new.email) = 'alpaslankarakus@gmail.com';
begin
  insert into public.profiles (id, email, full_name, avatar_url, status)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    case when is_admin then 'approved'::public.approval_status else 'pending'::public.approval_status end)
  on conflict (id) do nothing;
  if is_admin then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();