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
  can_edit_media_details boolean not null default false,
  can_rename_media boolean not null default false,
  can_delete_media boolean not null default false,
  can_submit_articles boolean not null default false,
  can_review_articles boolean not null default false,
  can_publish_articles boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists can_manage_media boolean not null default false;
alter table public.profiles add column if not exists media_buckets text[] not null default '{}';
alter table public.profiles add column if not exists can_edit_media_details boolean not null default false;
alter table public.profiles add column if not exists can_rename_media boolean not null default false;
alter table public.profiles add column if not exists can_delete_media boolean not null default false;
alter table public.profiles add column if not exists can_submit_articles boolean not null default false;
alter table public.profiles add column if not exists can_review_articles boolean not null default false;
alter table public.profiles add column if not exists can_publish_articles boolean not null default false;

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

create or replace function public.can_submit_articles()
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
        or can_submit_articles = true
      )
  );
$$;

create or replace function public.can_review_articles()
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
        or can_review_articles = true
        or can_publish_articles = true
      )
  );
$$;

create or replace function public.can_publish_articles()
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
        or can_publish_articles = true
      )
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

create or replace function public.can_upload_to_bucket(bucket_name text)
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
          and can_upload_photos = true
          and bucket_name = any(coalesce(media_buckets, '{}'))
        )
      )
  );
$$;

create or replace function public.can_update_bucket(bucket_name text)
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
          and (can_edit_media_details = true or can_rename_media = true)
          and bucket_name = any(coalesce(media_buckets, '{}'))
        )
      )
  );
$$;

create or replace function public.can_delete_from_bucket(bucket_name text)
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
          and can_delete_media = true
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

create table if not exists public.historical_photos (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  storage_path text not null unique,
  title text,
  caption text,
  story text not null default '',
  notes text not null default '',
  source text,
  photographer text,
  location text,
  taken_on date,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.historical_people (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.historical_photo_people (
  photo_id uuid not null references public.historical_photos(id) on delete cascade,
  person_id uuid not null references public.historical_people(id) on delete cascade,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (photo_id, person_id)
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
  author_name text not null default '',
  slug text not null unique,
  title text not null,
  summary text,
  body_markdown text not null default '',
  cover_image_path text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_notes text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'changes_requested', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.articles add column if not exists cover_image_path text;
alter table public.articles add column if not exists author_name text not null default '';
alter table public.articles add column if not exists submitted_at timestamptz;
alter table public.articles add column if not exists reviewed_at timestamptz;
alter table public.articles add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.articles add column if not exists review_notes text;

do $$
begin
  alter table public.articles
    drop constraint if exists articles_status_check;
  alter table public.articles
    add constraint articles_status_check
    check (status in ('draft', 'submitted', 'changes_requested', 'published', 'archived'));
exception when duplicate_object then null;
end $$;

create table if not exists public.article_images (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  alt_text text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.photo_albums enable row level security;
alter table public.photos enable row level security;
alter table public.historical_photos enable row level security;
alter table public.historical_people enable row level security;
alter table public.historical_photo_people enable row level security;
alter table public.recommendations enable row level security;
alter table public.articles enable row level security;
alter table public.article_images enable row level security;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;

create or replace function public.can_manage_article(article_uuid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.articles
    where id = article_uuid
      and (
        public.is_admin()
        or public.can_review_articles()
        or public.can_publish_articles()
        or author_id = auth.uid()
      )
  );
$$;

create or replace function public.can_view_article(article_uuid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.articles
    where id = article_uuid
      and (
        status = 'published'
        or author_id = auth.uid()
        or public.can_review_articles()
        or public.can_publish_articles()
        or public.is_admin()
      )
  );
$$;

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
  and public.can_upload_to_bucket(bucket_id)
);

drop policy if exists "media manager update selected buckets" on storage.objects;
create policy "media manager update selected buckets"
on storage.objects
for update
to authenticated
using (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_update_bucket(bucket_id)
)
with check (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_update_bucket(bucket_id)
);

drop policy if exists "media manager delete selected buckets" on storage.objects;
create policy "media manager delete selected buckets"
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('churchfirephotos', 'standingstonechurchconstructionphotos')
  and public.can_delete_from_bucket(bucket_id)
);

drop policy if exists "article images readable" on storage.objects;
create policy "article images readable"
on storage.objects
for select
using (
  bucket_id = 'article-images'
  and public.can_view_article(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "article images insert" on storage.objects;
create policy "article images insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'article-images'
  and public.can_manage_article(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "article images update" on storage.objects;
create policy "article images update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'article-images'
  and public.can_manage_article(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'article-images'
  and public.can_manage_article(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "article images delete" on storage.objects;
create policy "article images delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'article-images'
  and public.can_manage_article(((storage.foldername(name))[1])::uuid)
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

drop policy if exists "historical photos public read" on public.historical_photos;
create policy "historical photos public read"
on public.historical_photos
for select
using (published = true or public.is_admin());

drop policy if exists "historical photos admin manage" on public.historical_photos;
create policy "historical photos admin manage"
on public.historical_photos
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "historical people public read" on public.historical_people;
create policy "historical people public read"
on public.historical_people
for select
using (true);

drop policy if exists "historical people admin manage" on public.historical_people;
create policy "historical people admin manage"
on public.historical_people
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "historical photo people public read" on public.historical_photo_people;
create policy "historical photo people public read"
on public.historical_photo_people
for select
using (true);

drop policy if exists "historical photo people admin manage" on public.historical_photo_people;
create policy "historical photo people admin manage"
on public.historical_photo_people
for all
using (public.is_admin())
with check (public.is_admin());

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
using (
  status = 'published'
  or author_id = auth.uid()
  or public.can_review_articles()
  or public.can_publish_articles()
  or public.is_admin()
);

drop policy if exists "articles author insert" on public.articles;
create policy "articles author insert"
on public.articles
for insert
with check (
  author_id = auth.uid()
  and public.can_submit_articles()
);

drop policy if exists "articles author draft edit or admin" on public.articles;
create policy "articles author draft edit or admin"
on public.articles
for update
using (
  (author_id = auth.uid())
  or public.can_review_articles()
  or public.can_publish_articles()
  or public.is_admin()
)
with check (
  (author_id = auth.uid())
  or public.can_review_articles()
  or public.can_publish_articles()
  or public.is_admin()
);

drop policy if exists "articles author delete or admin" on public.articles;
create policy "articles author delete or admin"
on public.articles
for delete
using (
  author_id = auth.uid()
  or public.can_review_articles()
  or public.can_publish_articles()
  or public.is_admin()
);

drop policy if exists "article images readable by article visibility" on public.article_images;
create policy "article images readable by article visibility"
on public.article_images
for select
using (public.can_view_article(article_id));

drop policy if exists "article images managed by author or admin" on public.article_images;
create policy "article images managed by author or admin"
on public.article_images
for all
using (public.can_manage_article(article_id))
with check (public.can_manage_article(article_id));

-- After creating your user account, promote it once:
-- update public.profiles
-- set role = 'admin',
--     can_upload_photos = true,
--     can_manage_media = true,
--     can_edit_media_details = true,
--     can_rename_media = true,
--     can_delete_media = true,
--     can_submit_articles = true,
--     can_review_articles = true,
--     can_publish_articles = true,
--     media_buckets = array['churchfirephotos', 'standingstonechurchconstructionphotos']
-- where email = 'quentin@quentin.nichols.com';
