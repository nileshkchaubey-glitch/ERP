-- ============================================================
-- PHASE 1A - Multi-tenant core
-- Run this FIRST in Supabase SQL Editor. Then tell Claude Code to continue.
-- Safe to re-run (idempotent).
-- ============================================================

-- 1. Organizations (tenants)
CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE,
  gstin       text,
  phone       text,
  address     text,
  plan        text DEFAULT 'free',          -- free | pro | business (future SaaS)
  created_at  timestamptz DEFAULT now()
);

-- 2. Org membership: which user belongs to which org, with what role
CREATE TABLE IF NOT EXISTS org_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,                 -- = auth.users.id
  role       text NOT NULL DEFAULT 'staff', -- owner | admin | staff
  is_active  boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members (user_id);

-- 3. Org settings (shop profile for invoices/print)
CREATE TABLE IF NOT EXISTS org_settings (
  org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  shop_name       text,
  owner_name      text,
  phone           text,
  address         text,
  state           text,
  gstin           text,
  invoice_prefix  text DEFAULT 'INV-',
  next_invoice_no int DEFAULT 1001,
  terms           text,
  logo_url        text,
  print_format    text DEFAULT 'a4',        -- a4 | thermal | both
  updated_at      timestamptz DEFAULT now()
);

-- 4. Helper: the current user's org_id (used by every RLS policy)
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM org_members
  WHERE user_id = auth.uid() AND is_active = true
  ORDER BY created_at
  LIMIT 1;
$$;

-- 5. Helper: does current user have one of the given roles (in their org)?
CREATE OR REPLACE FUNCTION has_role(VARIADIC roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE user_id = auth.uid()
      AND is_active = true
      AND role = ANY(roles)
  );
$$;

-- 6. RLS on the new tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_self ON organizations;
CREATE POLICY org_self ON organizations
  FOR SELECT TO authenticated
  USING (id = current_org_id());

DROP POLICY IF EXISTS org_update ON organizations;
CREATE POLICY org_update ON organizations
  FOR UPDATE TO authenticated
  USING (id = current_org_id() AND has_role('owner','admin'))
  WITH CHECK (id = current_org_id() AND has_role('owner','admin'));

-- members can see their own org's members
DROP POLICY IF EXISTS members_read ON org_members;
CREATE POLICY members_read ON org_members
  FOR SELECT TO authenticated
  USING (org_id = current_org_id());

-- owner/admin manage members
DROP POLICY IF EXISTS members_manage ON org_members;
CREATE POLICY members_manage ON org_members
  FOR ALL TO authenticated
  USING (org_id = current_org_id() AND has_role('owner','admin'))
  WITH CHECK (org_id = current_org_id() AND has_role('owner','admin'));

DROP POLICY IF EXISTS settings_rw ON org_settings;
CREATE POLICY settings_rw ON org_settings
  FOR ALL TO authenticated
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- 7. Function to create an org + make the caller its owner (used by signup)
CREATE OR REPLACE FUNCTION create_org_for_me(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Business name is required';
  END IF;

  INSERT INTO organizations (name, slug)
  VALUES (
    trim(p_name),
    lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6)
  )
  RETURNING id INTO v_org;

  INSERT INTO org_members (org_id, user_id, role)
  VALUES (v_org, auth.uid(), 'owner');

  INSERT INTO org_settings (org_id, shop_name) VALUES (v_org, trim(p_name));

  RETURN v_org;
END; $$;

-- ============================================================
-- Done. New tenancy tables, helpers, RLS, and signup function ready.
-- Verify: SELECT * FROM organizations;   -- empty until first signup
-- ============================================================
