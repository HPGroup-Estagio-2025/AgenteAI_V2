-- Migration: Add website_url and WordPress fields to companies table
-- Run this in your Supabase SQL Editor

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wordpress_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wordpress_username TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wordpress_app_password TEXT DEFAULT NULL;
