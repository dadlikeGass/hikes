-- Stable geographic identities and reusable, directed trail segments.
-- Existing route_peaks/route_segments remain as per-route analysis rows during
-- API migration; no names are auto-merged because proximity is not identity.

CREATE TABLE IF NOT EXISTS mountains (
  id BIGSERIAL PRIMARY KEY,
  stable_key TEXT UNIQUE NOT NULL,
  name TEXT,
  altitude INT,
  geom GEOMETRY(Point, 4326),
  name_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (name_status IN ('unconfirmed', 'candidate', 'confirmed')),
  name_source JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mountains_geom ON mountains USING GIST (geom);

ALTER TABLE route_peaks ADD COLUMN IF NOT EXISTS mountain_id BIGINT
  REFERENCES mountains(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_route_peaks_mountain ON route_peaks (mountain_id);

-- Preserve existing route observations as separate, unconfirmed identities.
-- Cross-route deduplication requires reviewed evidence and is deliberately not
-- inferred from matching names or proximity during this compatibility migration.
INSERT INTO mountains (stable_key, name, altitude, geom, name_status)
SELECT 'legacy-route-peak:' || rp.route_id || ':' || rp.idx,
       rp.name, rp.altitude, rp.geom,
       CASE WHEN rp.name IS NULL THEN 'unconfirmed' ELSE 'candidate' END
FROM route_peaks rp
ON CONFLICT (stable_key) DO NOTHING;

UPDATE route_peaks rp
SET mountain_id = m.id
FROM mountains m
WHERE rp.mountain_id IS NULL
  AND m.stable_key = 'legacy-route-peak:' || rp.route_id || ':' || rp.idx;

CREATE TABLE IF NOT EXISTS trail_segments (
  id BIGSERIAL PRIMARY KEY,
  stable_key TEXT UNIQUE NOT NULL,
  start_name TEXT,
  end_name TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('ascending', 'descending', 'traverse')),
  geom GEOMETRY(LineString, 4326),
  km NUMERIC(7,2),
  gain_m INT,
  loss_m INT,
  difficulty TEXT CHECK (difficulty IN ('easy', 'mid', 'hard', 'hidden')),
  difficulty_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (difficulty_status IN ('candidate', 'confirmed')),
  algorithm_version TEXT,
  source_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trail_segments_geom ON trail_segments USING GIST (geom);

CREATE TABLE IF NOT EXISTS route_segment_links (
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  route_segment_no SMALLINT NOT NULL,
  trail_segment_id BIGINT NOT NULL REFERENCES trail_segments(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('ascending', 'descending', 'traverse')),
  from_km NUMERIC(7,2) NOT NULL,
  to_km NUMERIC(7,2) NOT NULL,
  PRIMARY KEY (route_id, route_segment_no, direction)
);
CREATE INDEX IF NOT EXISTS idx_route_segment_links_identity ON route_segment_links (trail_segment_id);

-- Boards reference both stable entity types, so create the table after both.
CREATE TABLE IF NOT EXISTS boards (
  id BIGSERIAL PRIMARY KEY,
  board_type TEXT NOT NULL CHECK (board_type IN ('summit', 'junction', 'segment')),
  mountain_id BIGINT UNIQUE REFERENCES mountains(id) ON DELETE CASCADE,
  junction_key TEXT UNIQUE,
  trail_segment_id BIGINT UNIQUE REFERENCES trail_segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(mountain_id, junction_key, trail_segment_id) = 1),
  CHECK ((board_type = 'summit' AND mountain_id IS NOT NULL)
      OR (board_type = 'junction' AND junction_key IS NOT NULL)
      OR (board_type = 'segment' AND trail_segment_id IS NOT NULL))
);

INSERT INTO boards (board_type, mountain_id)
SELECT 'summit', m.id FROM mountains m
WHERE m.stable_key LIKE 'legacy-route-peak:%'
ON CONFLICT (mountain_id) DO NOTHING;

-- Backfill every old algorithm slice as a route-scoped candidate segment.
-- These are not merged across routes until geometry/direction are reviewed.
INSERT INTO trail_segments (stable_key, start_name, end_name, direction, km,
                            gain_m, difficulty, algorithm_version, difficulty_status)
SELECT 'legacy-route-segment:' || rs.route_id || ':' || rs.no,
       NULL, NULL,
       CASE rs.kind WHEN 'climb' THEN 'ascending'
                    WHEN 'desc' THEN 'descending' ELSE 'traverse' END,
       rs.km, greatest(rs.rise, 0), rs.level, 'legacy-v1',
       CASE WHEN rs.confirmed THEN 'confirmed' ELSE 'candidate' END
FROM route_segments rs
ON CONFLICT (stable_key) DO NOTHING;

INSERT INTO route_segment_links
  (route_id, route_segment_no, trail_segment_id, direction, from_km, to_km)
SELECT rs.route_id, rs.no, ts.id,
       CASE rs.kind WHEN 'climb' THEN 'ascending'
                    WHEN 'desc' THEN 'descending' ELSE 'traverse' END,
       rs.from_km, rs.to_km
FROM route_segments rs
JOIN trail_segments ts
  ON ts.stable_key = 'legacy-route-segment:' || rs.route_id || ':' || rs.no
ON CONFLICT DO NOTHING;

INSERT INTO boards (board_type, trail_segment_id)
SELECT 'segment', ts.id FROM trail_segments ts
WHERE ts.stable_key LIKE 'legacy-route-segment:%'
ON CONFLICT (trail_segment_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS route_peak_candidates (
  id BIGSERIAL PRIMARY KEY,
  route_peak_id BIGINT NOT NULL REFERENCES route_peaks(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_url TEXT,
  candidate_name TEXT NOT NULL,
  candidate_lat NUMERIC(9,6),
  candidate_lng NUMERIC(9,6),
  distance_m INT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_peak_id, source, candidate_name)
);
CREATE INDEX IF NOT EXISTS idx_peak_candidates_status ON route_peak_candidates (status, created_at);
