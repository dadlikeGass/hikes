"""方向化分段难度 V2：新增候选、发布和旧新映射表；不修改旧 route_segments。

失败时 PostgreSQL 会回滚整个修订，旧 H5 与旧接口继续使用既有表。
"""
from alembic import op

revision = "0022_directional_difficulty"
down_revision = "0021_peak_nominations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS route_points_v2 (
        id BIGSERIAL PRIMARY KEY,
        stable_key TEXT NOT NULL UNIQUE,
        route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        segmentation_version TEXT NOT NULL,
        existing_point_id BIGINT REFERENCES points(id) ON DELETE SET NULL,
        forward_m INT NOT NULL CHECK (forward_m >= 0),
        forward_order INT NOT NULL CHECK (forward_order >= 0),
        point_type TEXT NOT NULL CHECK (point_type IN
          ('start','end','peak','valley','saddle','waist','supply','village','landmark')),
        name TEXT,
        latitude NUMERIC(10,7) NOT NULL,
        longitude NUMERIC(10,7) NOT NULL,
        elevation_m INT,
        review_status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (review_status IN ('candidate','kept','dropped','published','retired')),
        source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (route_id, segmentation_version, forward_order)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS route_segments_v2 (
        id BIGSERIAL PRIMARY KEY,
        stable_key TEXT NOT NULL UNIQUE,
        route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        segmentation_version TEXT NOT NULL,
        from_m INT NOT NULL CHECK (from_m >= 0),
        to_m INT NOT NULL CHECK (to_m > from_m),
        forward_order INT NOT NULL CHECK (forward_order > 0),
        reverse_order INT NOT NULL CHECK (reverse_order > 0),
        start_point_id BIGINT NOT NULL REFERENCES route_points_v2(id) ON DELETE RESTRICT,
        end_point_id BIGINT NOT NULL REFERENCES route_points_v2(id) ON DELETE RESTRICT,
        boundary_start_type TEXT,
        boundary_end_type TEXT,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate','reviewed','published','retired')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (route_id, segmentation_version, forward_order),
        UNIQUE (route_id, segmentation_version, reverse_order)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS segment_difficulty_results (
        id BIGSERIAL PRIMARY KEY,
        segment_id BIGINT NOT NULL REFERENCES route_segments_v2(id) ON DELETE CASCADE,
        travel_direction TEXT NOT NULL CHECK (travel_direction IN ('forward', 'reverse')),
        model_version TEXT NOT NULL,
        distance_m INT NOT NULL CHECK (distance_m > 0),
        ascent_m INT NOT NULL CHECK (ascent_m >= 0),
        descent_m INT NOT NULL CHECK (descent_m >= 0),
        max_100m_ascent_m NUMERIC,
        max_100m_descent_m NUMERIC,
        internal_score NUMERIC NOT NULL,
        base_grade TEXT NOT NULL,
        terrain_shift SMALLINT NOT NULL DEFAULT 0 CHECK (terrain_shift BETWEEN 0 AND 2),
        published_grade TEXT NOT NULL,
        terrain_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate','reviewed','published','retired')),
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (segment_id, travel_direction, model_version, payload_hash)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS route_difficulty_publications (
        id BIGSERIAL PRIMARY KEY,
        route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        segmentation_version TEXT NOT NULL,
        model_version TEXT NOT NULL,
        grade_version TEXT NOT NULL,
        publication_version INT NOT NULL CHECK (publication_version > 0),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','published','retired')),
        published_at TIMESTAMPTZ,
        published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        previous_publication_id BIGINT REFERENCES route_difficulty_publications(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (route_id, publication_version)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS route_difficulty_publication_items (
        publication_id BIGINT NOT NULL REFERENCES route_difficulty_publications(id) ON DELETE CASCADE,
        difficulty_result_id BIGINT NOT NULL REFERENCES segment_difficulty_results(id) ON DELETE RESTRICT,
        PRIMARY KEY (publication_id, difficulty_result_id)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS route_point_publication_items (
        publication_id BIGINT NOT NULL REFERENCES route_difficulty_publications(id) ON DELETE CASCADE,
        route_point_id BIGINT NOT NULL REFERENCES route_points_v2(id) ON DELETE RESTRICT,
        display_order INT NOT NULL CHECK (display_order >= 0),
        PRIMARY KEY (publication_id, route_point_id),
        UNIQUE (publication_id, display_order)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS route_publication_audit (
        id BIGSERIAL PRIMARY KEY,
        publication_id BIGINT NOT NULL REFERENCES route_difficulty_publications(id) ON DELETE CASCADE,
        actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        before_payload JSONB,
        after_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS route_point_review_audit (
        id BIGSERIAL PRIMARY KEY,
        route_point_id BIGINT NOT NULL REFERENCES route_points_v2(id) ON DELETE CASCADE,
        actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        before_payload JSONB NOT NULL,
        after_payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    op.execute("""CREATE OR REPLACE FUNCTION validate_difficulty_publication_item()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE publication route_difficulty_publications%ROWTYPE;
        DECLARE item_route_id BIGINT;
        DECLARE item_segmentation_version TEXT;
        DECLARE item_model_version TEXT;
        BEGIN
          SELECT * INTO publication FROM route_difficulty_publications
            WHERE id = NEW.publication_id;
          SELECT s.route_id, s.segmentation_version, d.model_version
            INTO item_route_id, item_segmentation_version, item_model_version
            FROM segment_difficulty_results d
            JOIN route_segments_v2 s ON s.id = d.segment_id
           WHERE d.id = NEW.difficulty_result_id;
          IF item_route_id IS DISTINCT FROM publication.route_id
             OR item_segmentation_version IS DISTINCT FROM publication.segmentation_version
             OR item_model_version IS DISTINCT FROM publication.model_version THEN
            RAISE EXCEPTION 'difficulty publication item lineage mismatch';
          END IF;
          RETURN NEW;
        END $$""")
    op.execute("""DROP TRIGGER IF EXISTS trg_validate_difficulty_publication_item
        ON route_difficulty_publication_items""")
    op.execute("""CREATE TRIGGER trg_validate_difficulty_publication_item
        BEFORE INSERT OR UPDATE ON route_difficulty_publication_items
        FOR EACH ROW EXECUTE FUNCTION validate_difficulty_publication_item()""")
    op.execute("""CREATE OR REPLACE FUNCTION validate_route_publication(target_publication_id BIGINT)
        RETURNS void LANGUAGE plpgsql AS $$
        DECLARE publication route_difficulty_publications%ROWTYPE;
        DECLARE duplicate_orders INT;
        DECLARE endpoint_errors INT;
        DECLARE continuity_errors INT;
        DECLARE direction_errors INT;
        DECLARE point_order_errors INT;
        BEGIN
          SELECT * INTO STRICT publication FROM route_difficulty_publications
           WHERE id = target_publication_id FOR UPDATE;
          SELECT count(*) - count(DISTINCT display_order) INTO duplicate_orders
            FROM route_point_publication_items WHERE publication_id = target_publication_id;
          IF (SELECT count(*) FROM route_point_publication_items
                WHERE publication_id = target_publication_id) < 2 THEN
            RAISE EXCEPTION 'route publication requires at least two points';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM route_difficulty_publication_items
                          WHERE publication_id = target_publication_id) THEN
            RAISE EXCEPTION 'route publication requires segments';
          END IF;
          SELECT count(*) INTO point_order_errors FROM (
            SELECT min(pi.display_order) AS first_order, max(pi.display_order) AS last_order,
                   count(*) AS point_count,
                   min(rp.forward_m) AS first_m, max(rp.forward_m) AS last_m,
                   min(rp.point_type) FILTER (WHERE pi.display_order=0) AS first_type,
                   min(rp.point_type) FILTER (WHERE pi.display_order=(
                     SELECT max(display_order) FROM route_point_publication_items
                      WHERE publication_id=target_publication_id)) AS last_type,
                   round(r.km*1000)::int AS route_m
              FROM route_point_publication_items pi
              JOIN route_points_v2 rp ON rp.id=pi.route_point_id
              JOIN routes r ON r.id=publication.route_id
             WHERE pi.publication_id=target_publication_id GROUP BY r.km
          ) point_bounds WHERE first_order<>0 OR last_order<>point_count-1
             OR first_m>25 OR abs(last_m-route_m)>25
             OR first_type<>'start' OR last_type<>'end';
          IF point_order_errors > 0 THEN
            RAISE EXCEPTION 'route point order or endpoints invalid';
          END IF;
          IF duplicate_orders > 0 THEN
            RAISE EXCEPTION 'duplicate route point order';
          END IF;
          SELECT count(*) INTO endpoint_errors
            FROM route_segments_v2 s
            JOIN route_difficulty_publication_items i ON i.publication_id = target_publication_id
            JOIN segment_difficulty_results d ON d.id = i.difficulty_result_id AND d.segment_id = s.id
            LEFT JOIN route_point_publication_items a
              ON a.publication_id = target_publication_id AND a.route_point_id = s.start_point_id
            LEFT JOIN route_point_publication_items b
              ON b.publication_id = target_publication_id AND b.route_point_id = s.end_point_id
           WHERE a.route_point_id IS NULL OR b.route_point_id IS NULL
              OR a.display_order >= b.display_order;
          IF endpoint_errors > 0 THEN
            RAISE EXCEPTION 'route segment endpoint mismatch';
          END IF;
          SELECT count(*) INTO continuity_errors FROM (
            SELECT s.from_m, lag(s.to_m) OVER (ORDER BY s.forward_order) AS previous_to_m
              FROM route_segments_v2 s
             WHERE s.route_id = publication.route_id
               AND s.segmentation_version = publication.segmentation_version
               AND EXISTS (
                 SELECT 1 FROM route_difficulty_publication_items i
                 JOIN segment_difficulty_results d ON d.id = i.difficulty_result_id
                  WHERE i.publication_id = target_publication_id AND d.segment_id = s.id)
          ) ordered_segments
          WHERE previous_to_m IS NOT NULL AND previous_to_m <> from_m;
          IF continuity_errors > 0 THEN
            RAISE EXCEPTION 'route segment gap or overlap';
          END IF;
          SELECT count(*) INTO direction_errors FROM (
            SELECT d.segment_id
              FROM route_difficulty_publication_items i
              JOIN segment_difficulty_results d ON d.id = i.difficulty_result_id
             WHERE i.publication_id = target_publication_id
             GROUP BY d.segment_id
            HAVING count(DISTINCT d.travel_direction) <> 2
          ) incomplete_directions;
          IF direction_errors > 0 THEN
            RAISE EXCEPTION 'missing directional result';
          END IF;
        END $$""")
    op.execute("""CREATE OR REPLACE FUNCTION enforce_route_publication()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM validate_route_publication(NEW.id);
          END IF;
          RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER trg_enforce_route_publication
        BEFORE UPDATE OF status ON route_difficulty_publications
        FOR EACH ROW EXECUTE FUNCTION enforce_route_publication()""")
    op.execute("""CREATE TABLE IF NOT EXISTS segment_migrations (
        legacy_segment_id BIGINT NOT NULL REFERENCES route_segments(id) ON DELETE CASCADE,
        new_segment_id BIGINT NOT NULL REFERENCES route_segments_v2(id) ON DELETE CASCADE,
        overlap_ratio NUMERIC NOT NULL CHECK (overlap_ratio BETWEEN 0 AND 1),
        mapping_type TEXT NOT NULL CHECK (mapping_type IN ('one_to_one','one_to_many','many_to_one','manual')),
        confidence NUMERIC NOT NULL CHECK (confidence BETWEEN 0 AND 1),
        review_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (review_status IN ('pending','confirmed','rejected')),
        PRIMARY KEY (legacy_segment_id, new_segment_id)
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS segment_terrain_feedback (
        id BIGSERIAL PRIMARY KEY,
        segment_id BIGINT NOT NULL REFERENCES route_segments_v2(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        travel_direction TEXT NOT NULL CHECK (travel_direction IN ('forward', 'reverse')),
        feedback_type TEXT NOT NULL DEFAULT 'long_term'
          CHECK (feedback_type IN ('long_term','temporary')),
        surface_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        technique_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        obstacle_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        extent TEXT NOT NULL CHECK (extent IN ('few','partial','major')),
        note TEXT NOT NULL DEFAULT '',
        review_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (review_status IN ('pending','accepted','rejected')),
        expires_at TIMESTAMPTZ,
        reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        review_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    op.execute("""CREATE TABLE IF NOT EXISTS segment_terrain_feedback_audit (
        id BIGSERIAL PRIMARY KEY,
        feedback_id BIGINT NOT NULL REFERENCES segment_terrain_feedback(id) ON DELETE CASCADE,
        actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        before_payload JSONB NOT NULL,
        after_payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    op.execute("""CREATE INDEX IF NOT EXISTS idx_segment_terrain_feedback_review
        ON segment_terrain_feedback(segment_id, review_status, created_at DESC)""")
    op.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_route_difficulty_one_published
        ON route_difficulty_publications(route_id) WHERE status = 'published'""")
    op.execute("""CREATE INDEX IF NOT EXISTS idx_segment_difficulty_public
        ON segment_difficulty_results(segment_id, travel_direction, status)""")


    op.execute("""CREATE TABLE IF NOT EXISTS route_point_confirmations (
        id BIGSERIAL PRIMARY KEY,
        route_point_id BIGINT NOT NULL REFERENCES route_points_v2(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        verdict TEXT NOT NULL CHECK (verdict IN ('confirm','relocate','reject')),
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (route_point_id, user_id)
    )""")
    op.execute("""CREATE INDEX IF NOT EXISTS idx_route_point_confirmations_point
        ON route_point_confirmations (route_point_id, verdict)""")

def downgrade() -> None:
    raise RuntimeError("This migration is forward-only; retire publications before manual rollback")
