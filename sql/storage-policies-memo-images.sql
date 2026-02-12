-- Run this in Supabase Dashboard → SQL Editor if you prefer not to use the CLI.
-- Create the bucket first: npm run create-bucket (or Dashboard → Storage → New bucket).

-- Allow uploads to memo-images
CREATE POLICY "Allow uploads to memo-images"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'memo-images');

-- Allow overwrite (upsert)
CREATE POLICY "Allow update in memo-images"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'memo-images')
WITH CHECK (bucket_id = 'memo-images');

-- Allow public read
CREATE POLICY "Allow public read memo-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'memo-images');
