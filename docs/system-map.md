# Bly System Map

This document is the plain-English integration map for the current account, permissions, media, and archive systems.

Use it alongside [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/blyoregon.org/supabase/schema.sql).

## Purpose

- `supabase/schema.sql` is the source of truth for database structure and policies.
- This file is the source of truth for how the app pieces connect.

## Current Systems

### Accounts and profiles

- Page: [account/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/account/index.html)
- Auth helper: [assets/auth.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/assets/auth.js)
- Profile API: [api/profile.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/profile.js)
- Account bootstrap API: [api/member-content.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/member-content.js)

`public.profiles` stores:
- identity fields like `display_name`, `avatar_path`, `bio`
- site role like `member` or `admin`
- media permissions and bucket access

Profile photo upload is separate from historical photo/media permissions.

### Permissions admin flow

- User list page: [account/permissions/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/account/permissions/index.html)
- Per-user permissions page: [account/permissions/user/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/account/permissions/user/index.html)
- Permissions API: [api/media-access.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/media-access.js)

Current permission fields in `public.profiles`:
- `can_upload_photos`
- `can_manage_media`
- `can_edit_media_details`
- `can_rename_media`
- `can_delete_media`
- `media_buckets`

Current meaning:
- `can_upload_photos`: upload files in media flows that check this flag
- `can_manage_media`: allow access to the media manager and bucket-scoped media actions
- `can_edit_media_details`: reserved for future metadata editing UI
- `can_rename_media`: reserved for future rename UI
- `can_delete_media`: controls file deletion in the media manager
- `media_buckets`: which managed buckets the user may work in

Admins bypass these checks.

### Media manager

- Page: [media-manager/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/media-manager/index.html)
- Photo editor page: [media-manager/photo/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/media-manager/photo/index.html)
- File list API: [api/media-list.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/media-list.js)
- Account bootstrap API: [api/member-content.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/member-content.js)
- Historical photo metadata API: [api/historical-photos.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/historical-photos.js)

Current behavior:
- the media manager reads the signed-in user profile from `/api/member-content`
- it only reveals buckets listed in `profile.mediaBuckets`
- upload controls follow `can_upload_photos`
- delete controls follow `can_delete_media`
- edit-detail links follow `can_edit_media_details`
- the dedicated photo editor saves metadata and tagged people through `/api/historical-photos`

Current managed buckets:
- `churchfirephotos`
- `standingstonechurchconstructionphotos`

### Public history galleries

- [history/photos/churchfirephotos/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/history/photos/churchfirephotos/index.html)
- [history/photos/standingstonechurchconstructionphotos/index.html](/Users/quentinnichols/Documents/Websites/blyoregon.org/history/photos/standingstonechurchconstructionphotos/index.html)
- Metadata API: [api/historical-photos.js](/Users/quentinnichols/Documents/Websites/blyoregon.org/api/historical-photos.js)

Current behavior:
- these pages now read `/api/historical-photos`
- that API merges storage files with `public.historical_photos` metadata rows
- files without metadata records still appear with fallback titles derived from the filename
- if a metadata row exists and `published = false`, that photo is hidden from the public gallery

This means:
- file uploads still appear publicly by default
- metadata can now affect public gallery titles, captions, and lightbox copy once records exist

## Database and Storage

### Database source of truth

- Schema: [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/blyoregon.org/supabase/schema.sql)

This file defines:
- tables
- columns
- RLS policies
- helper SQL functions
- storage bucket policies

Historical archive tables now include:
- `historical_photos`
- `historical_people`
- `historical_photo_people`

### Current storage policy functions

In `supabase/schema.sql`:
- `public.can_manage_bucket(bucket_name text)`
- `public.can_upload_to_bucket(bucket_name text)`
- `public.can_update_bucket(bucket_name text)`
- `public.can_delete_from_bucket(bucket_name text)`

These functions are used by storage policies to decide whether a signed-in user may upload, update, or delete within the managed media buckets.

## Current Gaps

### Metadata-driven archives are not built yet

The archive metadata foundation now exists, but the admin editing tools for that metadata are not built yet.

Right now there is no admin editing UI yet for:
- source notes
- locations
- historical dates
- rename actions in the media manager

### Action-level permissions are only partially consumed

These exist in the profile model now:
- `can_edit_media_details`
- `can_rename_media`

But the current UI does not yet implement:
- metadata editing
- rename actions

## Recommended Next Archive Model

If the historical photo archive will support stories, tagged people, and richer public pages, use database photo records as the source of truth.

Recommended direction:
- keep image files in storage
- keep archive metadata in database rows
- render public galleries from metadata-aware APIs instead of raw storage file lists

Minimum future metadata model:
- stable photo id
- bucket / collection
- storage path
- title
- caption
- story
- notes
- date taken
- location
- source
- photographer / contributor
- published flag
- sort order

Recommended future relations:
- `people`
- join table from photos to people

## Rules For Future Updates

When changing this system, update all three when relevant:

1. [supabase/schema.sql](/Users/quentinnichols/Documents/Websites/blyoregon.org/supabase/schema.sql)
2. [supabase/README.md](/Users/quentinnichols/Documents/Websites/blyoregon.org/supabase/README.md)
3. [docs/system-map.md](/Users/quentinnichols/Documents/Websites/blyoregon.org/docs/system-map.md)

Update this file whenever any of these change:
- new permission fields
- new APIs
- new archive metadata tables
- public gallery data source changes
- storage policy changes

## Practical Rule

If you want to know:
- what exists in the database: check `supabase/schema.sql`
- how the pieces connect: check `docs/system-map.md`
- what Supabase is expected to provide: check `supabase/README.md`
