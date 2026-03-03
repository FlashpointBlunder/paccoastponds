-- ============================================================
-- Shop schema: extend products/categories, add order tables
-- ============================================================

-- Slug + shop fields on products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS slug                  text UNIQUE,
  ADD COLUMN IF NOT EXISTS subscribe_save_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shop_description      text,
  ADD COLUMN IF NOT EXISTS meta_title            text,
  ADD COLUMN IF NOT EXISTS meta_description      text,
  ADD COLUMN IF NOT EXISTS brand                 text,
  ADD COLUMN IF NOT EXISTS weight_oz             numeric,
  ADD COLUMN IF NOT EXISTS length_in             numeric,
  ADD COLUMN IF NOT EXISTS width_in              numeric,
  ADD COLUMN IF NOT EXISTS height_in             numeric,
  ADD COLUMN IF NOT EXISTS stock_status          text NOT NULL DEFAULT 'in_stock';

-- Slug on categories
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS slug text;

-- Generate slugs for all categories from name
UPDATE product_categories
SET slug = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

-- Shop orders
CREATE TABLE IF NOT EXISTS shop_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number             text NOT NULL UNIQUE,
  customer_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_email           text NOT NULL,
  customer_name            text NOT NULL,
  shipping_address         jsonb NOT NULL,
  subtotal                 numeric NOT NULL,
  shipping_cost            numeric NOT NULL DEFAULT 0,
  discount_amount          numeric NOT NULL DEFAULT 0,
  total                    numeric NOT NULL,
  stripe_payment_intent_id text,
  status                   text NOT NULL DEFAULT 'pending',
  notes                    text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

-- Shop order items
CREATE TABLE IF NOT EXISTS shop_order_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id              uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name            text NOT NULL,
  product_sku             text,
  quantity                integer NOT NULL,
  unit_price              numeric NOT NULL,
  subscribe_save_applied  boolean NOT NULL DEFAULT false,
  created_at              timestamptz DEFAULT now()
);

-- Subscribe & Save opt-ins
CREATE TABLE IF NOT EXISTS shop_subscribers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE shop_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage shop_orders"      ON shop_orders;
DROP POLICY IF EXISTS "Admins manage shop_order_items" ON shop_order_items;
DROP POLICY IF EXISTS "Admins manage shop_subscribers" ON shop_subscribers;
DROP POLICY IF EXISTS "Customers view own orders"      ON shop_orders;
DROP POLICY IF EXISTS "Customers view own order items" ON shop_order_items;
DROP POLICY IF EXISTS "Customers manage own subscription" ON shop_subscribers;

CREATE POLICY "Admins manage shop_orders"      ON shop_orders      FOR ALL USING (is_admin());
CREATE POLICY "Admins manage shop_order_items" ON shop_order_items FOR ALL USING (is_admin());
CREATE POLICY "Admins manage shop_subscribers" ON shop_subscribers FOR ALL USING (is_admin());

CREATE POLICY "Customers view own orders"
  ON shop_orders FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "Customers view own order items"
  ON shop_order_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM shop_orders WHERE id = order_id AND customer_id = auth.uid()
  ));

CREATE POLICY "Customers manage own subscription"
  ON shop_subscribers FOR ALL
  USING (user_id = auth.uid());

-- Public read for active products (shop needs anon access)
DROP POLICY IF EXISTS "Public read products" ON products;
CREATE POLICY "Public read products"
  ON products FOR SELECT
  USING (active = true);

DROP POLICY IF EXISTS "Public read categories" ON product_categories;
CREATE POLICY "Public read categories"
  ON product_categories FOR SELECT
  USING (true);

-- Function to check if current user is a shop subscriber
CREATE OR REPLACE FUNCTION is_shop_subscriber()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM shop_subscribers
    WHERE user_id = auth.uid()
  );
END;
$$;

-- Auto-generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  seq int;
BEGIN
  SELECT COUNT(*) + 1 INTO seq FROM shop_orders;
  RETURN 'PCP-' || LPAD(seq::text, 5, '0');
END;
$$;
