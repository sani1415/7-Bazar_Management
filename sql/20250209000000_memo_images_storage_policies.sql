-- Storage policies for memo-images bucket (bill + memo photos).
-- Run after creating the bucket (e.g. via npm run create-bucket).
-- Apply with: supabase db push (when linked) or run this in Dashboard → SQL Editor.

-- Allow anyone (anon) to upload to memo-images
CREATE POLICY "Allow uploads to memo-images"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'memo-images');

-- Allow overwrite (upsert) for memo-images
CREATE POLICY "Allow update in memo-images"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'memo-images')
WITH CHECK (bucket_id = 'memo-images');

-- Allow public read (for public URLs)
CREATE POLICY "Allow public read memo-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'memo-images');
