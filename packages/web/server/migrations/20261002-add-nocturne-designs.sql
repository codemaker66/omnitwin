-- Extend the dedicated Trades Hall review database with the two requested
-- Nocturne options. Replacing this check is atomic and preserves every response.
ALTER TABLE card_review.responses
  DROP CONSTRAINT IF EXISTS responses_favourite_check,
  ADD CONSTRAINT responses_favourite_check
    CHECK (favourite IN ('38','43','46','35','29','32','33','21','22','15','02','01-v2','05','nocturne','nocturne-2'));
