CREATE TABLE venue_inventory_stock (
  venue_id uuid NOT NULL REFERENCES venues(id),
  asset_definition_id uuid NOT NULL REFERENCES asset_definitions(id),
  revision bigint NOT NULL,
  owned_quantity bigint NOT NULL,
  damaged_quantity bigint NOT NULL,
  unavailable_quantity bigint NOT NULL,
  hires jsonb NOT NULL,
  storage_location varchar(240),
  status varchar(20) NOT NULL,
  effective_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (venue_id, asset_definition_id),
  CONSTRAINT venue_inventory_stock_revision CHECK (revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT venue_inventory_stock_counts CHECK (
    owned_quantity BETWEEN 0 AND 9007199254740991 AND damaged_quantity >= 0 AND unavailable_quantity >= 0
    AND damaged_quantity <= owned_quantity AND unavailable_quantity <= owned_quantity - damaged_quantity),
  CONSTRAINT venue_inventory_stock_status CHECK (status IN ('active', 'retired')),
  CONSTRAINT venue_inventory_stock_storage CHECK (storage_location IS NULL OR length(btrim(storage_location)) > 0),
  CONSTRAINT venue_inventory_stock_hires CHECK (jsonb_typeof(hires) = 'array' AND jsonb_array_length(hires) <= 2000)
);
--> statement-breakpoint
CREATE TABLE venue_inventory_receipts (
  venue_id uuid NOT NULL REFERENCES venues(id),
  command_id uuid NOT NULL,
  asset_definition_id uuid NOT NULL REFERENCES asset_definitions(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  revision bigint NOT NULL,
  recorded_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (venue_id, command_id),
  FOREIGN KEY (venue_id, asset_definition_id) REFERENCES venue_inventory_stock(venue_id, asset_definition_id),
  CONSTRAINT venue_inventory_receipts_revision CHECK (revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT venue_inventory_receipts_object CHECK (jsonb_typeof(payload) = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX venue_inventory_receipts_revision_unique ON venue_inventory_receipts(venue_id, asset_definition_id, revision);
