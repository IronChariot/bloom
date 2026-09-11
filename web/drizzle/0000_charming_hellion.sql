CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`graph` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	`invite_hash` text,
	`agent_hash` text,
	`agent_enabled` integer DEFAULT 1 NOT NULL,
	`image` text,
	`image_at` integer,
	`past` text DEFAULT '[]' NOT NULL,
	`future` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `changes` (
	`board_id` text NOT NULL,
	`revision` integer NOT NULL,
	`graph` text NOT NULL,
	`actor` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`board_id`, `revision`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`board_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`seen` integer NOT NULL,
	PRIMARY KEY(`board_id`, `user_id`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_user` ON `members` (`user_id`);