-- ============================================================
-- Laguna Koi Digital Transformation: Pricing, Kiosk, & Rewards
-- ============================================================

-- 1. Extend koi_fish for Tiered Pricing & Location
ALTER TABLE koi_fish
  ADD COLUMN IF NOT EXISTS base_cost      numeric(10,2),
  ADD COLUMN IF NOT EXISTS quality_tier   text CHECK (quality_tier IN ('A', 'B', 'C', 'S', 'Wholesale')),
  ADD COLUMN IF NOT EXISTS location       text NOT NULL DEFAULT 'Virtual'
                                          CHECK (location IN ('In-Store (Aliso Viejo)', 'Virtual', 'Quarantine')),
  ADD COLUMN IF NOT EXISTS color_tags     text[] DEFAULT '{}';

-- 2. Extend profiles for Rewards
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS rewards_balance integer NOT NULL DEFAULT 0;

-- 3. Rewards Ledger for tracking history
CREATE TABLE IF NOT EXISTS rewards_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id    uuid REFERENCES shop_orders(id) ON DELETE SET NULL,
  points      integer NOT NULL,
  type        text NOT NULL CHECK (type IN ('earn', 'redeem', 'adjustment')),
  description text,
  created_at  timestamptz DEFAULT now()
);

-- RLS for Rewards Ledger
ALTER TABLE rewards_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own rewards ledger"
  ON rewards_ledger FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admins manage all rewards"
  ON rewards_ledger FOR ALL
  USING (is_admin());

-- 4. Helper Function for Tiered Pricing Calculation
CREATE OR REPLACE FUNCTION calculate_koi_price(cost numeric, tier text)
RETURNS numeric AS $$
BEGIN
  RETURN CASE
    WHEN tier IN ('A', 'B', 'C') THEN cost * 5.0  -- Using middle of 4.5x - 7x range as default
    WHEN tier = 'S'              THEN cost * 2.5  -- Using middle of 2x - 3x range
    WHEN tier = 'Wholesale'      THEN cost * 2.75 -- Using middle of 2.5x - 3x range
    ELSE cost * 4.5
  END;
END;
$$ LANGUAGE plpgsql;
