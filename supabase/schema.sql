-- Core schema for Bly members, submissions, and admin moderation.
-- Run this in the Supabase SQL editor after enabling the project.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  avatar_path text,
  bio text,
  role text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  can_manage_media boolean not null default false,
  media_buckets text[] not null default '{}',
  can_upload_photos boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists can_manage_media boolean not null default false;
alter table public.profiles add column if not exists media_buckets text[] not null default '{}';

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.can_manage_bucket(bucket_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role = 'admin'
        or (
          can_manage_media = true
          and bucket_name = any(coalesce(media_buckets, '{}'))
        )
      )
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.photo_albums (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  visibility text not null default 'public' check (visibility in ('public', 'members', 'admin')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid references public.photo_albums(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  storage_path text not null unique,
  title text,
  caption text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  visibility text not null default 'public' check (visibility in ('public', 'members', 'admin')),
  taken_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  category text not null,
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  slug text not null unique,
  title text not null,
  summary text,
  body_markdown text not null default '',
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.photo_albums enable row level security;
alter table public.photos enable row level security;
alter table public.recommendations enable row level security;
alter table public.articles enable row level security;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

drop policy if exists "profile photos public read" on storage.objects;
create policy "profile photos public read"
on storage.objects
for select
using (bucket_id = 'profile-photos');

drop policy if exists "profile photos upload own" on storage.objects;
create policy "profile photos upload own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "profile photos update own" on storage.objects;
create policy "profile photos update own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "profile photos delete own" on storage.objects;
create policy "profile photos delete own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "media manager upload selected buckets" on storage.objects;
create policy "media manager upload selected buckets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_manage_bucket(bucket_id)
);

drop policy if exists "media manager update selected buckets" on storage.objects;
create policy "media manager update selected buckets"
on storage.objects
for update
to authenticated
using (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_manage_bucket(bucket_id)
)
with check (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_manage_bucket(bucket_id)
);

drop policy if exists "media manager delete selected buckets" on storage.objects;
create policy "media manager delete selected buckets"
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_manage_bucket(bucket_id)
);

drop policy if exists "profiles view own or admin" on public.profiles;
create policy "profiles view own or admin"
on public.profiles
for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles update own or admin" on public.profiles;
create policy "profiles update own or admin"
on public.profiles
for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "albums public read" on public.photo_albums;
create policy "albums public read"
on public.photo_albums
for select
using (
  visibility = 'public'
  or (visibility = 'members' and auth.uid() is not null)
  or (visibility = 'admin' and public.is_admin())
);

drop policy if exists "albums admin manage" on public.photo_albums;
create policy "albums admin manage"
on public.photo_albums
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "photos readable by visibility" on public.photos;
create policy "photos readable by visibility"
on public.photos
for select
using (
  status = 'approved'
  and (
    visibility = 'public'
    or (visibility = 'members' and auth.uid() is not null)
    or (visibility = 'admin' and public.is_admin())
  )
  or owner_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "photos submit own" on public.photos;
create policy "photos submit own"
on public.photos
for insert
with check (auth.uid() = owner_id);

drop policy if exists "photos update own pending or admin" on public.photos;
create policy "photos update own pending or admin"
on public.photos
for update
using ((owner_id = auth.uid() and status = 'pending') or public.is_admin())
with check ((owner_id = auth.uid() and status = 'pending') or public.is_admin());

drop policy if exists "recommendations readable" on public.recommendations;
create policy "recommendations readable"
on public.recommendations
for select
using (status = 'approved' or author_id = auth.uid() or public.is_admin());

drop policy if exists "recommendations submit own" on public.recommendations;
create policy "recommendations submit own"
on public.recommendations
for insert
with check (author_id = auth.uid());

drop policy if exists "recommendations update own pending or admin" on public.recommendations;
create policy "recommendations update own pending or admin"
on public.recommendations
for update
using ((author_id = auth.uid() and status = 'pending') or public.is_admin())
with check ((author_id = auth.uid() and status = 'pending') or public.is_admin());

drop policy if exists "articles published read" on public.articles;
create policy "articles published read"
on public.articles
for select
using (status = 'published' or author_id = auth.uid() or public.is_admin());

drop policy if exists "articles author insert" on public.articles;
create policy "articles author insert"
on public.articles
for insert
with check (author_id = auth.uid());

drop policy if exists "articles author draft edit or admin" on public.articles;
create policy "articles author draft edit or admin"
on public.articles
for update
using ((author_id = auth.uid() and status in ('draft', 'pending_review')) or public.is_admin())
with check ((author_id = auth.uid() and status in ('draft', 'pending_review')) or public.is_admin());

-- After creating your user account, promote it once:
-- update public.profiles
-- set role = 'admin',
--     can_upload_photos = true,
--     can_manage_media = true,
--     media_buckets = array['churchfirephotos', 'standingstonechurchconstructionphotos']
-- where email = 'quentin@quentin.nichols.com';
