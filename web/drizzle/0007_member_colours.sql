ALTER TABLE `members` ADD `color` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing members get distinct colours in the order they joined each board, owner first.
UPDATE `members` SET `color` = (SELECT `slot` FROM (SELECT `board_id`, `user_id`, (ROW_NUMBER() OVER (PARTITION BY `board_id` ORDER BY `role` <> 'owner', `seen`) - 1) % 8 AS `slot` FROM `members`) AS `ranked` WHERE `ranked`.`board_id` = `members`.`board_id` AND `ranked`.`user_id` = `members`.`user_id`);
