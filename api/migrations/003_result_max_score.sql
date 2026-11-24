-- Snapshot the denominator so quiz edits cannot change existing percentages.
ALTER TABLE results ADD COLUMN max_score INTEGER CHECK (max_score >= 0);
UPDATE results SET max_score = (
  SELECT COALESCE(SUM((SELECT MAX((o->>'score')::integer)
    FROM jsonb_array_elements(q->'options') o)), 0)
  FROM config c, jsonb_array_elements(c.json::jsonb->'questions') q
  WHERE c.id=1 AND q->>'type'='scored'
) WHERE version=(SELECT (json::jsonb->>'version')::integer FROM config WHERE id=1);
