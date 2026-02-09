-- Supabase Database Schema for Grocery Management System
-- Run this SQL in your Supabase SQL Editor

-- Create grocery_entries table
CREATE TABLE IF NOT EXISTS grocery_entries (
    id BIGSERIAL PRIMARY KEY,
    entry_date DATE NOT NULL,
    total_cost DECIMAL(10, 2) NOT NULL,
    item_count INTEGER NOT NULL,
    comment TEXT,
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create grocery_items table
CREATE TABLE IF NOT EXISTS grocery_items (
    id BIGSERIAL PRIMARY KEY,
    entry_id BIGINT NOT NULL REFERENCES grocery_entries(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    price_per_unit DECIMAL(10, 2) NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    category VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create balance table (for tracking worker's current balance)
CREATE TABLE IF NOT EXISTS balance (
    id BIGSERIAL PRIMARY KEY,
    current_balance DECIMAL(10, 2) DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(255)
);

-- Insert initial balance record
INSERT INTO balance (current_balance, last_updated) 
VALUES (0, NOW())
ON CONFLICT DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_entries_date ON grocery_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_entries_payment ON grocery_entries(payment_status);
CREATE INDEX IF NOT EXISTS idx_items_entry_id ON grocery_items(entry_id);
CREATE INDEX IF NOT EXISTS idx_items_name ON grocery_items(item_name);
CREATE INDEX IF NOT EXISTS idx_items_category ON grocery_items(category);

-- Enable Row Level Security (RLS) - Optional, but recommended
-- For now, we'll allow all operations since there's no authentication
ALTER TABLE grocery_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations (since no auth for now)
CREATE POLICY "Allow all operations on grocery_entries" ON grocery_entries
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on grocery_items" ON grocery_items
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on balance" ON balance
    FOR ALL USING (true) WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_grocery_entries_updated_at 
    BEFORE UPDATE ON grocery_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
