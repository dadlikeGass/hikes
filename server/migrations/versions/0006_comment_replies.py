from alembic import op
revision = "0006_comment_replies"
down_revision = "0005_route_profile_cp"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""CREATE TABLE comment_replies (id BIGSERIAL PRIMARY KEY,
        comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
    op.execute("CREATE INDEX comment_replies_parent ON comment_replies(comment_id, created_at)")

def downgrade():
    op.drop_table("comment_replies")
