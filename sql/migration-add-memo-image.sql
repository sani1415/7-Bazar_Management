-- Run this in Supabase SQL Editor if you get:
-- "Could not find the 'memo_image_url' column of 'grocery_items' in the schema cache"
-- (Adds the column to an existing grocery_items table.)

ALTER TABLE grocery_items ADD COLUMN IF NOT EXISTS memo_image_url TEXT;
