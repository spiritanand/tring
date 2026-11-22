CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_name` text NOT NULL,
	`phone` text NOT NULL,
	`reason` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookings_start_idx` ON `bookings` (`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `bookings_phone_idx` ON `bookings` (`phone`);--> statement-breakpoint
CREATE TABLE `clinic` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`doctor_name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`fee` text NOT NULL,
	`slot_minutes` integer NOT NULL,
	`buffer_minutes` integer NOT NULL,
	`weekly_hours` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`input` text NOT NULL,
	`reply` text NOT NULL,
	`steps` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turns_session_idx` ON `turns` (`session_id`,`id`);