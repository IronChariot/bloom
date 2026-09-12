ALTER TABLE `boards` ADD `content_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `layout_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE boards SET content_revision = revision, layout_revision = revision;
