/**
 * Create the memo-images storage bucket in your linked Supabase project.
 * Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) from .env.
 *
 * Run: node scripts/create-memo-bucket.js
 * Or:  npm run create-bucket
 *
 * Get Service Role key from: Dashboard → Project Settings → API → service_role (secret)
 */

const path = require('path');
const fs = require('fs');

// Load .env from project root
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const BUCKET_NAME = 'memo-images';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in .env');
  console.error('For creating buckets, use the service_role key from Dashboard → Settings → API.');
  process.exit(1);
}

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase.storage.createBucket(BUCKET_NAME, {
    public: true,
    fileSizeLimit: 52428800, // 50 MB
  });

  if (error) {
    if (error.message && error.message.includes('already exists')) {
      console.log('Bucket "memo-images" already exists. OK.');
      return;
    }
    if (error.message && error.message.includes('row-level security')) {
      console.error('Bucket creation was denied (RLS). Use the service_role key, not the anon key.');
      console.error('Add SUPABASE_SERVICE_ROLE_KEY to .env from Dashboard → Settings → API → service_role');
      process.exit(1);
    }
    console.error('Error creating bucket:', error.message);
    process.exit(1);
  }
  console.log('Bucket "memo-images" created successfully (public: true).');
  console.log('Next: apply storage policies (see docs/SUPABASE-STORAGE-BUCKET.md or run Supabase migration).');
}

main();
