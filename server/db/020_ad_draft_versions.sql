-- Maintainers can save incomplete creative and revise rejected submissions.
ALTER TABLE summit_ads DROP CONSTRAINT IF EXISTS summit_ads_status_check;
ALTER TABLE summit_ads ADD CONSTRAINT summit_ads_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired'));
ALTER TABLE summit_ads ADD COLUMN IF NOT EXISTS duration_days INT NOT NULL DEFAULT 30
  CHECK (duration_days BETWEEN 1 AND 30);
