-- ============================================================
-- Koi Fish: one-of-a-kind live koi product listings
-- Separate from general products table — koi have unique
-- attributes (variety, breeder, age, sex, size) and are
-- always qty=1 with sold/available status.
-- ============================================================

CREATE TABLE IF NOT EXISTS koi_fish (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identity ──────────────────────────────────────────────
  sku               text UNIQUE NOT NULL,          -- e.g. "KOI-0042"
  variety           text NOT NULL,                  -- e.g. "Gin Rin Karashigoi", "Platinum Ogon"
  breeder           text,                           -- e.g. "Maruhiro", "Dainichi"
  nickname          text,                           -- optional pet name

  -- ── Physical Details ──────────────────────────────────────
  size_inches       numeric(5,1),                   -- e.g. 17.0
  sex               text CHECK (sex IN ('Male', 'Female', 'Unknown')) DEFAULT 'Unknown',
  age               text,                           -- e.g. "2023", "Nisai", "Sansai"
  body_type         text,                           -- e.g. "Standard", "Doitsu", "Gin Rin", "Butterfly"

  -- ── Pricing ───────────────────────────────────────────────
  price             numeric(10,2) NOT NULL,         -- current/sale price
  original_price    numeric(10,2),                  -- original price (if on sale)

  -- ── Status ────────────────────────────────────────────────
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'available', 'reserved', 'sold', 'archived')),
  featured          boolean NOT NULL DEFAULT false,

  -- ── Photos ────────────────────────────────────────────────
  -- Primary processed photo (blue background)
  photo_url         text,
  -- Original raw photo (before processing)
  photo_raw_url     text,
  -- Additional photos (array of URLs)
  extra_photos      text[] DEFAULT '{}',

  -- ── Description & SEO ─────────────────────────────────────
  description       text,                           -- rich text / markdown description
  slug              text UNIQUE,                    -- URL slug for product page

  -- ── Sale tracking ─────────────────────────────────────────
  buyer_email       text,
  buyer_name        text,
  sold_at           timestamptz,
  stripe_payment_id text,
  order_id          uuid REFERENCES shop_orders(id) ON DELETE SET NULL,

  -- ── Timestamps ────────────────────────────────────────────
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- ── Auto-generate slug from variety + sku ────────────────────
CREATE OR REPLACE FUNCTION koi_fish_auto_slug()
RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := lower(regexp_replace(trim(NEW.variety), '[^a-zA-Z0-9]+', '-', 'g'))
                || '-' || lower(NEW.sku);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER koi_fish_slug_trigger
  BEFORE INSERT OR UPDATE ON koi_fish
  FOR EACH ROW EXECUTE FUNCTION koi_fish_auto_slug();

-- ── Auto-increment SKU sequence ──────────────────────────────
CREATE SEQUENCE IF NOT EXISTS koi_fish_sku_seq START 1;

CREATE OR REPLACE FUNCTION koi_fish_auto_sku()
RETURNS trigger AS $$
DECLARE seq int;
BEGIN
  IF NEW.sku IS NULL OR NEW.sku = '' THEN
    seq := nextval('koi_fish_sku_seq');
    NEW.sku := 'KOI-' || LPAD(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER koi_fish_sku_trigger
  BEFORE INSERT ON koi_fish
  FOR EACH ROW EXECUTE FUNCTION koi_fish_auto_sku();

-- ── updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION koi_fish_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER koi_fish_updated_at_trigger
  BEFORE UPDATE ON koi_fish
  FOR EACH ROW EXECUTE FUNCTION koi_fish_updated_at();

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE koi_fish ENABLE ROW LEVEL SECURITY;

-- Public: anyone can read available fish (shop browsing)
CREATE POLICY "koi_fish_public_read" ON koi_fish
  FOR SELECT USING (status IN ('available', 'sold'));

-- Admin: full CRUD
CREATE POLICY "koi_fish_admin_all" ON koi_fish
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_koi_fish_status   ON koi_fish (status);
CREATE INDEX IF NOT EXISTS idx_koi_fish_variety  ON koi_fish (variety);
CREATE INDEX IF NOT EXISTS idx_koi_fish_slug     ON koi_fish (slug);
CREATE INDEX IF NOT EXISTS idx_koi_fish_featured ON koi_fish (featured) WHERE featured = true;

-- ── Variety lookup table (for filtering/autocomplete) ────────
CREATE TABLE IF NOT EXISTS koi_varieties (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text UNIQUE NOT NULL,              -- e.g. "Kohaku", "Showa", "Sanke"
  category     text,                               -- e.g. "Gosanke", "Hikari", "Kawarimono"
  description  text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE koi_varieties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "koi_varieties_public_read" ON koi_varieties
  FOR SELECT USING (true);

CREATE POLICY "koi_varieties_admin_all" ON koi_varieties
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Seed common koi varieties ────────────────────────────────
INSERT INTO koi_varieties (name, category) VALUES
  ('Kohaku',               'Gosanke'),
  ('Taisho Sanke',         'Gosanke'),
  ('Showa',                'Gosanke'),
  ('Tancho',               'Tancho'),
  ('Tancho Kohaku',        'Tancho'),
  ('Tancho Showa',         'Tancho'),
  ('Asagi',                'Asagi / Shusui'),
  ('Shusui',               'Asagi / Shusui'),
  ('Bekko',                'Bekko'),
  ('Utsuri',               'Utsurimono'),
  ('Hi Utsuri',            'Utsurimono'),
  ('Ki Utsuri',            'Utsurimono'),
  ('Shiro Utsuri',         'Utsurimono'),
  ('Goshiki',              'Goshiki'),
  ('Goromo',               'Koromo'),
  ('Ai Goromo',            'Koromo'),
  ('Budo Goromo',          'Koromo'),
  ('Ogon',                 'Hikari Muji'),
  ('Platinum Ogon',        'Hikari Muji'),
  ('Yamabuki Ogon',        'Hikari Muji'),
  ('Orenji Ogon',          'Hikari Muji'),
  ('Kujaku',               'Hikari Moyo'),
  ('Hariwake',             'Hikari Moyo'),
  ('Lemon Hariwake',       'Hikari Moyo'),
  ('Doitsu Hariwake',      'Hikari Moyo'),
  ('Kikokuryu',            'Hikari Moyo'),
  ('Beni Kikokuryu',       'Hikari Moyo'),
  ('Gin Rin Kohaku',       'Gin Rin'),
  ('Gin Rin Showa',        'Gin Rin'),
  ('Gin Rin Sanke',        'Gin Rin'),
  ('Gin Rin Soragoi',      'Gin Rin'),
  ('Gin Rin Karashigoi',   'Gin Rin'),
  ('Gin Rin Platinum Ogon','Gin Rin'),
  ('Gin Rin Benigoi',      'Gin Rin'),
  ('Soragoi',              'Kawarimono'),
  ('Chagoi',               'Kawarimono'),
  ('Karashigoi',           'Kawarimono'),
  ('Ochiba',               'Kawarimono'),
  ('Kumonryu',             'Kawarimono'),
  ('Benigoi',              'Kawarimono'),
  ('Matsuba',              'Kawarimono'),
  ('Butterfly Koi',        'Butterfly'),
  ('Doitsu Kohaku',        'Doitsu'),
  ('Doitsu Showa',         'Doitsu'),
  ('Doitsu Sanke',         'Doitsu')
ON CONFLICT (name) DO NOTHING;
