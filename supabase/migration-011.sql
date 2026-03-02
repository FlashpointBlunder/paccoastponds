-- Proposal types: service (existing) and build (new)
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS proposal_type   text    NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS build_subtotal  numeric,
  ADD COLUMN IF NOT EXISTS build_overhead  numeric,
  ADD COLUMN IF NOT EXISTS build_profit    numeric;

-- Per-line-item detail notes (build proposals)
ALTER TABLE proposal_line_items
  ADD COLUMN IF NOT EXISTS notes text;

-- Update public RPC to return new proposal columns
DROP FUNCTION IF EXISTS get_proposal_public(uuid);
CREATE OR REPLACE FUNCTION get_proposal_public(p_token uuid)
RETURNS TABLE(
  id uuid, title text, notes text, status text, image_url text,
  proposal_type text, build_subtotal numeric, build_overhead numeric, build_profit numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.title, p.notes, p.status, p.image_url,
           p.proposal_type, p.build_subtotal, p.build_overhead, p.build_profit
    FROM proposals p WHERE p.public_token = p_token;
END;
$$;

-- Update public line items RPC to return notes
DROP FUNCTION IF EXISTS get_proposal_items_public(uuid);
CREATE OR REPLACE FUNCTION get_proposal_items_public(p_proposal_id uuid)
RETURNS TABLE(description text, quantity numeric, unit_price numeric, sort_order int, notes text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT i.description, i.quantity, i.unit_price, i.sort_order, i.notes
    FROM proposal_line_items i
    WHERE i.proposal_id = p_proposal_id
    ORDER BY i.sort_order;
END;
$$;
