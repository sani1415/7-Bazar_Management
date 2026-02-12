# বাজার ম্যানেজমেন্ট – CSV ইমপোর্ট ফরম্যাট

## Permission to upload data

- The app imports data **into your own Supabase project**. You are uploading **your own** bazar/grocery data.
- No extra “permission” is needed from anyone: you control the Supabase project and the app only writes to tables you created (with your schema and RLS).
- On Android, the app already has file-read permission so you can pick a CSV file from your device.

---

## Supported format: CSV (Excel can export this)

The app accepts **CSV** (Comma-Separated Values). Excel can save any sheet as CSV.

### Column order (ইংরেজি ফরম্যাট)

| Column # | Header (optional) | Meaning        | Example   |
|----------|-------------------|----------------|-----------|
| 1        | entry_date        | Entry date     | 2024-01-15 |
| 2        | item_name         | Item name      | চাল       |
| 3        | quantity          | Quantity       | 5         |
| 4        | unit              | Unit           | কেজি      |
| 5        | price_per_unit    | Price per unit | 70        |
| 6        | total_price       | Total price (optional) | 350   |

- You can use **either**:
  - **price_per_unit** (column 5): the app calculates total as `quantity × price_per_unit`, or  
  - **total_price** (column 6): leave price_per_unit empty; the app will **calculate per-unit price** as `total_price ÷ quantity`.
- **Date** must be in English format: **YYYY-MM-DD** (e.g. `2024-01-15`).

---

## Excel steps

1. In Excel, make columns in this order:  
   `entry_date`, `item_name`, `quantity`, `unit`, `price_per_unit`, `total_price`
2. Fill your data. Use either `price_per_unit` or `total_price` per row.
3. **Save As** → choose **CSV (Comma delimited) (*.csv)**.
4. In the app: open **বিল ইমপোর্ট** tab → paste the CSV text or choose the saved `.csv` file → click **ইমপোর্ট করুন**.

---

## Sample CSV (copy and paste to test)

```csv
entry_date,item_name,quantity,unit,price_per_unit,total_price
2024-01-15,চাল,5,কেজি,70,
2024-01-15,ডাল,2,কেজি,120,
2024-01-15,মাছ,1,কেজি,,450
2024-01-16,তেল,1,লিটার,180,
2024-01-16,পেঁয়াজ,2,কেজি,45,
```

- Rows 1–2, 4–5: use **price_per_unit** (total is calculated).
- Row 3: use **total_price** only (450); price_per_unit is left empty.

A file version of this sample is in the project: **`bazar-import-sample.csv`**.
