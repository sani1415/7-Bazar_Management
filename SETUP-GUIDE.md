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

### Step 3: Open Your HTML File

1. Simply open `grocery-app-improved-mockup.html` in your web browser
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

## Next Steps (Optional)

- Add image upload functionality
- Add filters and search
- Add export to Excel
- Add user authentication (later)

## Need Help?

If you encounter any issues, check:
1. Browser console for errors (F12)
2. Supabase logs in dashboard
3. Make sure all SQL was executed successfully
