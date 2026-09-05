BEGIN;
DO $$ BEGIN
  IF current_database() <> 'venviewer_inventory_20260905' THEN
    RAISE EXCEPTION 'This fixture only belongs in the isolated inventory database';
  END IF;
END $$;
DELETE FROM venue_inventory_receipts WHERE venue_id IN ('59100000-0000-4000-8000-000000000001', '59100000-0000-4000-8000-000000000002');
DELETE FROM venue_inventory_stock WHERE venue_id IN ('59100000-0000-4000-8000-000000000001', '59100000-0000-4000-8000-000000000002');
INSERT INTO venues(id,name,slug,address) VALUES
('59100000-0000-4000-8000-000000000001','Trades Hall · local fixture','inventory-local-591','Local integration fixture'),
('59100000-0000-4000-8000-000000000002','Other venue · local fixture','inventory-other-591','Local integration fixture')
ON CONFLICT(id) DO NOTHING;
INSERT INTO users(id,email,name,role,venue_id) VALUES
('59100000-0000-4000-8000-000000000011','elaine@inventory.local.test','Elaine · local fixture','admin','59100000-0000-4000-8000-000000000001'),
('59100000-0000-4000-8000-000000000012','other@inventory.local.test','Other administrator · local fixture','admin','59100000-0000-4000-8000-000000000002')
ON CONFLICT(id) DO NOTHING;
INSERT INTO asset_definitions(id,name,category,width_m,depth_m,height_m,seat_count) VALUES
('59100000-0000-4000-8000-000000000021','Chiavari chair','chair',0.45,0.45,0.9,1),
('59100000-0000-4000-8000-000000000022','Round table','table',1.8,1.8,0.75,10),
('59100000-0000-4000-8000-000000000023','Projector','av',0.3,0.2,0.12,0)
ON CONFLICT(id) DO NOTHING;
COMMIT;
