PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_grants` (
	`owner` text NOT NULL,
	`board_id` text NOT NULL,
	`agent_hash` text NOT NULL,
	PRIMARY KEY(`owner`, `board_id`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agent_grants`("owner", "board_id", "agent_hash") SELECT "owner", "board_id", "agent_hash" FROM `agent_grants`;--> statement-breakpoint
DROP TABLE `agent_grants`;--> statement-breakpoint
ALTER TABLE `__new_agent_grants` RENAME TO `agent_grants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_agent_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created` integer NOT NULL,
	`used` integer
);
--> statement-breakpoint
INSERT INTO `__new_agent_connections`("id", "owner", "label", "token_hash", "created", "used") SELECT lower(hex(randomblob(16))), "owner", 'First connection', "token_hash", "created", NULL FROM `agent_connections`;--> statement-breakpoint
DROP TABLE `agent_connections`;--> statement-breakpoint
ALTER TABLE `__new_agent_connections` RENAME TO `agent_connections`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connections_token_hash_unique` ON `agent_connections` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_connections_owner` ON `agent_connections` (`owner`);