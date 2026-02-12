-- Allow edit_log to keep rows when an entry is deleted (for "Entry deleted" audit).
-- Makes entry_id nullable and changes FK to ON DELETE SET NULL.

ALTER TABLE edit_log ALTER COLUMN entry_id DROP NOT NULL;

ALTER TABLE edit_log DROP CONSTRAINT IF EXISTS edit_log_entry_id_fkey;

ALTER TABLE edit_log ADD CONSTRAINT edit_log_entry_id_fkey
    FOREIGN KEY (entry_id) REFERENCES grocery_entries(id) ON DELETE SET NULL;
