Supabase foundation for Bly members.

Use [schema.sql](/Users/quentinnichols/Documents/Websites/blyoregon.org/supabase/schema.sql) in the Supabase SQL editor. It creates:
- `profiles` for member identity and role
- `photo_albums` and `photos`
- `recommendations`
- `articles`
- a trigger to create a profile row when a new auth user signs up
- RLS policies for members, authors, and admins

Recommended admin model:
- regular users can sign up and submit content
- submissions default to `pending`
- admins approve, reject, edit, publish, and manage visibility
- your account should be promoted by updating `public.profiles.role = 'admin'`

System integration map:
- See [docs/system-map.md](/Users/quentinnichols/Documents/Websites/blyoregon.org/docs/system-map.md) for how profiles, permissions pages, APIs, storage buckets, media manager, and public history galleries connect.
- Keep `schema.sql`, this README, and `docs/system-map.md` updated together when you add new data models or permissions.

Recommended next implementation steps in this site:
1. Build a profile bootstrap call on first login.
2. Add member submission forms for recommendations and articles.
3. Add signed photo upload to a Supabase Storage bucket.
4. Add an admin dashboard for moderation and publishing.
