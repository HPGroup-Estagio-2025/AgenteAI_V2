-- Run this in Supabase SQL Editor to create the companies table

CREATE TABLE IF NOT EXISTS companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE
);

ALTER TABLE companies ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Disable RLS or add policy to allow service_role full access
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Allow service_role to do everything (bypasses RLS by default, but explicit for clarity)
CREATE POLICY "service_role_all" ON companies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated reads (optional)
CREATE POLICY "anon_read" ON companies
  FOR SELECT
  TO anon
  USING (active = true);
