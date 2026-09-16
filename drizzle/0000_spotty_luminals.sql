CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (`name`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`client_id` text NOT NULL,
	`ticket` text NOT NULL,
	`date` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`billed` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_member_date` ON `entries` (`member_id`,`date`);--> statement-breakpoint
CREATE INDEX `entries_date_client` ON `entries` (`date`,`client_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'partner' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_unique` ON `members` (`user_id`);