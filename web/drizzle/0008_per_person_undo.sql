CREATE TABLE `undo_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`board_id` text NOT NULL,
	`user_id` text NOT NULL,
	`patch` text NOT NULL,
	`undone` integer DEFAULT 0 NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `undo_steps_person` ON `undo_steps` (`board_id`,`user_id`,`undone`);