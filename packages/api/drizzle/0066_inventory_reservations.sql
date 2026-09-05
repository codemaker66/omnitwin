CREATE TABLE inventory_reservation_releases (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  event_id uuid NOT NULL,
  space_id uuid NOT NULL,
  revision bigint NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT inventory_release_revision CHECK (revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT inventory_release_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT inventory_release_event_venue FOREIGN KEY (event_id, venue_id) REFERENCES events(id, venue_id),
  CONSTRAINT inventory_release_space_venue FOREIGN KEY (space_id, venue_id) REFERENCES spaces(id, venue_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_release_scope_revision ON inventory_reservation_releases(venue_id, event_id, space_id, revision);
--> statement-breakpoint
CREATE TABLE inventory_remedy_requests (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  prepared_by uuid NOT NULL REFERENCES users(id),
  prepared_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT inventory_remedy_payload CHECK (jsonb_typeof(payload) = 'object')
);
--> statement-breakpoint
CREATE INDEX inventory_remedy_venue ON inventory_remedy_requests(venue_id, prepared_at);
--> statement-breakpoint
CREATE TABLE inventory_decision_commands (
  venue_id uuid NOT NULL REFERENCES venues(id),
  command_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  operation varchar(40) NOT NULL,
  command jsonb NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (venue_id, command_id),
  CONSTRAINT inventory_decision_operation CHECK (operation IN ('reservation_approve', 'reservation_revoke', 'remedy_prepare', 'remedy_approve')),
  CONSTRAINT inventory_decision_objects CHECK (jsonb_typeof(command) = 'object' AND jsonb_typeof(result) = 'object')
);
--> statement-breakpoint
CREATE FUNCTION prevent_inventory_decision_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory decision history is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_release_immutable BEFORE UPDATE OR DELETE ON inventory_reservation_releases
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_decision_history_mutation();
--> statement-breakpoint
CREATE TRIGGER inventory_decision_immutable BEFORE UPDATE OR DELETE ON inventory_decision_commands
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_decision_history_mutation();
