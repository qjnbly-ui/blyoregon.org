Supabase foundation for Bly members.

Use [schema.sql](/Users/quentinnichols/Documents/Websites/blyoregon.org/supabase/schema.sql) in the Supabase SQL editor. It creates:
- `profiles` for member identity and role
- `photo_albums` and `photos`
- `recommendations`
- `articles` and `article_images` for dynamic user-submitted article publishing
- `notifications` for stored internal account inbox activity
- `historical_photos`, `historical_people`, and `historical_photo_people` for archive metadata
- a trigger to create a profile row when a new auth user signs up
- RLS policies for members, authors, and admins
- storage bucket policies for `profile-photos`, managed archive buckets, and `article-images`

Recommended admin model:
- regular users can sign up and submit content
- article submission is a standard member capability by default
- user articles can move through `draft`, `submitted`, `changes_requested`, `published`, and `archived`
- admins or delegated reviewers can request changes or publish approved submissions
- article workflow events can create both email notifications and stored internal notifications
- users can now control article email/inbox delivery preferences from their account profile
- admins have a read-only system settings screen for env-managed delivery behavior
- your account should be promoted by updating `public.profiles.role = 'admin'`

System integration map:
- See [docs/system-map.md](/Users/quentinnichols/Documents/Websites/blyoregon.org/docs/system-map.md) for how profiles, permissions pages, APIs, storage buckets, media manager, public history galleries, and dynamic article publishing connect.
- Keep `schema.sql`, this README, and `docs/system-map.md` updated together when you add new data models or permissions.

Recommended next implementation steps in this site:
1. Apply the latest schema changes in Supabase before testing dynamic article submission.
2. Promote your own account with article permissions if needed.
3. Test the member draft -> submit -> review -> publish flow with one article and one uploaded image.
4. Confirm notifications appear in `/account/notifications/` for the author and reviewers.
5. Refine the public article presentation or fall back to static HTML refinement if the dynamic flow is not sufficient.
