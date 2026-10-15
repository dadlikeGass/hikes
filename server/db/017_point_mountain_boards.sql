-- Connect physical summit QR points to stable mountain/board identities.
-- Route point -> route peak uses route_id and the existing one-based index.
-- No cross-route names or coordinates are merged automatically.
ALTER TABLE points ADD COLUMN IF NOT EXISTS mountain_id BIGINT REFERENCES mountains(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_points_mountain ON points (mountain_id) WHERE mountain_id IS NOT NULL;

UPDATE points p SET mountain_id = rp.mountain_id
FROM route_peaks rp
WHERE p.type = 'peak' AND p.mountain_id IS NULL
  AND p.route_id = rp.route_id AND p.index_in_route = rp.idx + 1;

INSERT INTO mountains (stable_key, name, altitude, geom, name_status)
SELECT 'point:' || p.code, p.name, p.altitude, p.geom,
       CASE WHEN p.name IS NULL THEN 'unconfirmed' ELSE 'candidate' END
FROM points p WHERE p.type = 'peak' AND p.mountain_id IS NULL
ON CONFLICT (stable_key) DO NOTHING;

UPDATE points p SET mountain_id = m.id
FROM mountains m
WHERE p.type = 'peak' AND p.mountain_id IS NULL AND m.stable_key = 'point:' || p.code;

INSERT INTO boards (board_type, mountain_id)
SELECT 'summit', m.id FROM mountains m
JOIN points p ON p.mountain_id = m.id WHERE p.type = 'peak'
ON CONFLICT (mountain_id) DO NOTHING;
