CREATE TABLE `agent_connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connections_token_hash_unique` ON `agent_connections` (`token_hash`);--> statement-breakpoint
CREATE TABLE `agent_grants` (
	`owner` text NOT NULL,
	`board_id` text NOT NULL,
	`agent_hash` text NOT NULL,
	PRIMARY KEY(`owner`, `board_id`),
	FOREIGN KEY (`owner`) REFERENCES `agent_connections`(`owner`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `boards` ADD `agent_secret` text;--> statement-breakpoint
CREATE UNIQUE INDEX `boards_agent_hash` ON `boards` (`agent_hash`);