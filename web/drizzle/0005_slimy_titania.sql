CREATE TABLE `edit_locks` (
	`board_id` text NOT NULL,
	`node_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`board_id`, `node_id`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `presence` (
	`board_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ids` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`board_id`, `session_id`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
