-- ============================================================
-- Koi Insurance: Add insurance fields to shop_order_items
-- ============================================================

ALTER TABLE shop_order_items
  ADD COLUMN IF NOT EXISTS koi_id               uuid REFERENCES koi_fish(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS has_koi_insurance    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS koi_insurance_price  numeric NOT NULL DEFAULT 0;
