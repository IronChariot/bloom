ALTER TABLE `boards` ADD `image_requested` integer;--> statement-breakpoint
ALTER TABLE `boards` ADD `image_revision` integer;
--> statement-breakpoint
CREATE TABLE __bloom_retained_history AS
WITH refs AS (
  SELECT b.id AS board_id, p.value AS revision, json_array_length(b.past) - p.key AS distance FROM boards b, json_each(b.past) p
  UNION ALL
  SELECT b.id, f.value, json_array_length(b.future) - f.key FROM boards b, json_each(b.future) f
), ranked AS (
  SELECT c.board_id, c.revision,
    row_number() OVER (PARTITION BY c.board_id ORDER BY r.distance, c.revision DESC) AS position,
    sum(length(CAST(c.graph AS BLOB))) OVER (PARTITION BY c.board_id ORDER BY r.distance, c.revision DESC) AS bytes
  FROM changes c JOIN refs r ON c.board_id = r.board_id AND c.revision = r.revision
)
SELECT board_id, revision FROM ranked WHERE position <= 50 AND bytes <= 8388608;
--> statement-breakpoint
UPDATE boards SET
  past = (SELECT json_group_array(value) FROM (SELECT p.value FROM json_each(boards.past) p WHERE p.value IN (SELECT revision FROM __bloom_retained_history WHERE board_id = boards.id) ORDER BY p.key)),
  future = (SELECT json_group_array(value) FROM (SELECT f.value FROM json_each(boards.future) f WHERE f.value IN (SELECT revision FROM __bloom_retained_history WHERE board_id = boards.id) ORDER BY f.key));
--> statement-breakpoint
DELETE FROM changes WHERE NOT EXISTS (SELECT 1 FROM __bloom_retained_history r WHERE r.board_id = changes.board_id AND r.revision = changes.revision);
--> statement-breakpoint
DROP TABLE __bloom_retained_history;
--> statement-breakpoint
UPDATE boards SET image = NULL, image_at = NULL WHERE length(image) > 700000;
