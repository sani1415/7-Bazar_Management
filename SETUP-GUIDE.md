# 🛒 বাজার ম্যানেজমেন্ট সিস্টেম - Setup Guide

## Step-by-Step Setup Instructions

### Step 1: Set Up Supabase Database

1. **Go to your Supabase Dashboard**
   - Visit: https://supabase.com/dashboard
   - Login to your account
   - Select your project (or create a new one)

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New Query"

3. **Run the Database Schema**
   - Open the file `supabase-schema.sql` in this folder
   - Copy ALL the SQL code
   - Paste it into the Supabase SQL Editor
   - Click "Run" or press `Ctrl+Enter`

4. **Verify Tables Created**
   - Go to "Table Editor" in the left sidebar
   - You should see 3 tables:
     - `grocery_entries`
     - `grocery_items`
     - `balance`

### Step 2: Verify Supabase Connection

Your HTML file already has your Supabase credentials configured:
- URL: `https://vdzpvgmgjbbdezqbovrk.supabase.co`
- Key: Already set in the code

### Step 3: Open the App

1. Open **`index.html`** in your web browser (same folder must contain `styles.css` and `app.js`).
2. The app should work immediately!

## Features Now Working

✅ **Save Grocery Entries** - Click "✓ এন্ট্রি সেভ করুন" to save
✅ **View All Entries** - Switch to "অ্যাডমিন ভিউ" to see all saved entries
✅ **Real-time Calculations** - Totals calculate automatically
✅ **Payment Status** - Mark entries as paid/pending
✅ **Statistics** - View monthly totals and averages
✅ **Top Items** - See most purchased items

## How to Use

### For Worker (বাজারকারী):
1. Select date
2. Click quick items or type manually
3. Enter quantity, unit, and price
4. Add more rows if needed
5. Click "✓ এন্ট্রি সেভ করুন"

### For Admin:
1. Switch to "অ্যাডমিন ভিউ"
2. View statistics and recent entries
3. Click "পরিশোধিত করুন" to mark as paid
4. Click "বিস্তারিত" to see entry details

## Troubleshooting

### If you see errors:
1. **Check Supabase Connection**
   - Make sure you ran the SQL schema
   - Verify tables exist in Table Editor

2. **Check Browser Console**
   - Press `F12` to open Developer Tools
   - Look for any error messages in Console tab

3. **Verify Credentials**
   - Make sure Supabase URL and key are correct in the HTML file

## Storage: LocalStorage vs Supabase

The app can run with **localStorage** (no server) or **Supabase**. Right now it uses **localStorage** by default.

- **To keep using localStorage:** Do nothing. Data is saved in your browser only.
- **To switch to Supabase:** Open **`app.js`** in an editor, find near the top:
  ```js
  const USE_LOCAL_STORAGE = true;
  ```
  Change to `false`, save, and refresh the app. Make sure you have run the SQL schema and tables exist.

## CSV / Excel import format (বিল ইমপোর্ট)

To **upload data** (old bills) into the app, use the **বিল ইমপোর্ট** tab. The app imports **CSV** files. You can prepare data in Excel and save as **CSV (Comma delimited)**.

**Columns (in order):**

| Column | Name            | Example    |
|--------|-----------------|------------|
| 1      | entry_date      | 2024-01-15 |
| 2      | item_name       | চাল        |
| 3      | quantity        | 5          |
| 4      | unit            | কেজি       |
| 5      | price_per_unit  | 70         |
| 6      | total_price     | (optional) |

- Use **either** column 5 (price_per_unit) **or** column 6 (total_price); the app will calculate the other (if you give only total, it calculates per-unit automatically).
- Date: **YYYY-MM-DD** (Gregorian, e.g. 2024-01-15) or **DD-MM-YYYY** (Hijri, e.g. 20-02-1447). Both work in CSV import.

A **sample file** is in the project: **`bazar-import-sample.csv`**. Full details: **`docs/CSV-IMPORT-FORMAT.md`**.

## Next Steps (Optional)

- Add image upload functionality
- Add filters and search
- Add export to Excel
- Add user authentication (later)

---

## Building the Android App (Capacitor)

The project is set up with **Capacitor** so you can build and run it as an Android app.

### What you need

- **Node.js & npm** – you already have these (you ran `npm install`).
- **Android Studio** – you said you have it.
- **Android SDK** – installed from Android Studio (see below).
- **JDK** – Android Studio usually bundles one; use the one it suggests.

### 1. Check development tools in Android Studio

1. Open **Android Studio**.
2. Go to **File → Settings** (or **Android Studio → Preferences** on Mac).
3. Open **Languages & Frameworks → Android SDK**:
   - **SDK Location** should be set (e.g. `C:\Users\YourName\AppData\Local\Android\Sdk`).
   - On the **SDK Platforms** tab, install at least one **Android API** (e.g. **API 34** or **API 33**).
   - On the **SDK Tools** tab, ensure **Android SDK Build-Tools** and **Android SDK Platform-Tools** are installed.
4. For **JDK**: go to **File → Project Structure → SDK Location**. Set **JDK location** to the one Android Studio provides (e.g. embedded JDK) if it’s not set.

### 2. Copy web app into `www` (after code changes)

Whenever you change `index.html`, `app.js`, or `styles.css`, run:

```bash
npm run copy
```

Then sync to Android:

```bash
npx cap sync android
```

### 3. Open the Android project and run

1. In your project folder, run:
   ```bash
   npx cap open android
   ```
   This opens the **`android`** folder in Android Studio.

2. In Android Studio:
   - Wait for **Gradle sync** to finish (first time can take a few minutes).
   - If it asks to install SDK or accept licenses, do it.
   - Connect a phone (with USB debugging on) or start an **AVD** (emulator): **Tools → Device Manager**.

3. Click the green **Run** button (or **Run → Run 'app'**) to build and install the app on the device or emulator.

### 4. If you see errors

- **“SDK location not found”**  
  Set **ANDROID_HOME** (or **ANDROID_SDK_ROOT**) to your Android SDK path (same as in **File → Settings → Android SDK**).

- **“JDK not found” or “Unsupported class file version”**  
  In **File → Project Structure → SDK Location**, set **JDK location** to the JDK that comes with Android Studio (e.g. `jbr` or the bundled JDK).

- **Gradle sync failed**  
  Use **File → Invalidate Caches / Restart** and sync again. Ensure you have a stable internet connection so Gradle can download dependencies.

### 5. Summary of commands

| What you want to do        | Command                 |
|----------------------------|-------------------------|
| Copy web files to `www`    | `npm run copy`          |
| Sync web + config to Android | `npx cap sync android` |
| Open project in Android Studio | `npx cap open android` |

---

## Pushing to GitHub

**Yes, it’s OK to push all the new files** (android/, assets/, scripts/, www/, capacitor.config.json, and your changes). Here’s what’s going on:

- **Not pushed (ignored):**  
  `.env`, `node_modules/`, `android/build/`, `android/.gradle/`, `android/local.properties`, and other entries in the root and `android/` `.gitignore` files. Your secrets (e.g. in `.env`) stay local.

- **Pushed:**  
  Source code, Android project (without build outputs), web app in `www/`, scripts, config, and the app icon in `assets/`. This is what you want in the repo.

Before pushing, run `git status` and make sure `.env` does **not** appear. If it does, add `.env` to `.gitignore` and do not add that file.

---

## Need Help?

If you encounter any issues, check:
1. Browser console for errors (F12)
2. Supabase logs in dashboard
3. Make sure all SQL was executed successfully
4. For Android: SDK and JDK in Android Studio (see “Building the Android App” above)
