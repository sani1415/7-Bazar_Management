# SQL scripts for Bazar Management (Supabase)

All Supabase-related SQL lives in this folder.

| File | Use |
|------|-----|
| **schema.sql** | Main database schema (tables, RLS, triggers). Run first in a new project. |
| **migration-add-memo-image.sql** | Adds `memo_image_url` to `grocery_items` if you get a schema-cache error. |
| **storage-policies-memo-images.sql** | Storage RLS for the `memo-images` bucket. Run after creating the bucket. |
| **20250209000000_memo_images_storage_policies.sql** | Same policies as above; used by `npx supabase db push` (also kept in `supabase/migrations/` for the CLI). |
| **20250212000000_edit_log_allow_delete_log.sql** | Makes `edit_log.entry_id` nullable and FK `ON DELETE SET NULL` so delete events stay in the log. |

Run these in **Supabase Dashboard → SQL Editor**, or use **`npx supabase db push`** for the migration file after linking.
