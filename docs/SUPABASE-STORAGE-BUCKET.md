# Create Supabase Storage Bucket for Image Uploads

The app uploads **bill images** and **memo images** (per item) to Supabase Storage. If you see "no bucket available", create the bucket and policies below.

**Bucket name the app uses:** `memo-images`

---

## Option A: Using CLI and script (recommended)

### 1. Add Service Role key to `.env`

Bucket creation needs the **service_role** key (not the anon key).

1. In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Settings** → **API**.
2. Copy the **service_role** key (secret).
3. In your project root, open `.env` and add (or update):
   ```env
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```
   Keep `SUPABASE_URL` and `SUPABASE_KEY` (anon) as they are.

### 2. Create the bucket from the project folder

In a terminal, from the project root:

```bash
npm run create-bucket
```

Or:

```bash
node scripts/create-memo-bucket.js
```

You should see: `Bucket "memo-images" created successfully` (or "already exists").

### 3. Apply storage policies

**Option 3a – Supabase CLI** (if you use the CLI):

1. Link the project (one-time):  
   `npx supabase link --project-ref YOUR_PROJECT_REF`  
   (Project ref = the part of your URL before `.supabase.co`, e.g. `kajaxkqwxbbgmdlqkcjn`.)
2. Push the migration:  
   `npx supabase db push`  
   This applies the migration (same as **`sql/20250209000000_memo_images_storage_policies.sql`**).

**Option 3b – Dashboard SQL Editor:**

1. Dashboard → **SQL Editor** → New query.
2. Paste the contents of **`sql/storage-policies-memo-images.sql`**.
3. Run the query.

### 4. Test

Open the app, add an entry with a bill or memo image, and save. The "no bucket available" message should be gone.

---

## Option B: Using the Dashboard only

### Step 1: Open your Supabase project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Sign in and open your project (the one whose URL and key you use in the app).

---

## Step 2: Go to Storage

1. In the left sidebar, click **Storage**.
2. You should see a list of buckets (it may be empty). Click **New bucket**.

---

## Step 3: Create the bucket

1. **Name:** Type exactly: **`memo-images`**  
   (The app is hard-coded to use this name.)
2. **Public bucket:** Turn **ON** (enable it).  
   This lets the app show images via public URLs (bill and memo photos).
3. **File size limit:** Leave default (e.g. 50 MB) or set what you prefer.
4. **Allowed MIME types:** Leave empty to allow images (e.g. image/jpeg, image/png).
5. Click **Create bucket**.

---

## Step 4: Allow uploads (Storage policies)

By default Supabase may block uploads. Add a policy so the app (using your anon key) can upload files.

1. In **Storage**, click the **`memo-images`** bucket.
2. Click **Policies** (or the "shield" / policy icon for this bucket).
3. Click **New policy**.
4. Choose **For full customization** (or "Create policy from scratch").

**Policy 1 – Allow upload (INSERT):**

- **Policy name:** `Allow uploads to memo-images`
- **Allowed operation(s):** Check **INSERT** (and **UPDATE** if you want to allow overwriting).
- **Target roles:** `public` (or leave as is so anon users are included).
- **USING expression:** `true`
- **WITH CHECK expression:** `true`

Click **Review** then **Save policy**.

**Policy 2 – Allow read (SELECT):**

- **Policy name:** `Allow public read memo-images`
- **Allowed operation(s):** Check **SELECT**.
- **USING expression:** `true`

Save.

*(If the bucket is **Public**, reads may already work; adding SELECT policy ensures it.)*

---

## Step 5: Test in the app

1. Open the app (worker view).
2. Add an entry and attach a **bill image** or a **memo image** (camera icon) on an item.
3. Save. You should no longer see "no bucket available", and the image should appear after save.

---

## Summary

| What        | Value / Action                          |
|------------|------------------------------------------|
| Bucket name| `memo-images`                            |
| Public     | Yes                                      |
| Policies   | INSERT (and optionally UPDATE), SELECT   |

If you use a different bucket name, you must change the constant in **`app/app.js`** (search for `MEMO_BUCKET`).
