-- Rafeequl Hifz (رفيق الحفظ) - Database Schema
-- MySQL Database: rafeequl_hifz

CREATE DATABASE IF NOT EXISTS `rafeequl_hifz`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE `rafeequl_hifz`;

-- 1. users table
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `user_type` ENUM('NEW', 'EXISTING', 'COMPLETE') NOT NULL DEFAULT 'NEW',
    `current_hifz_page` INT NOT NULL DEFAULT 0,
    `daily_murajaah_target_pages` INT NOT NULL DEFAULT 100,
    `murajaah_days` INT NOT NULL DEFAULT 6,
    `rabt_extra_pages` INT NOT NULL DEFAULT 0,
    `last_tikrar_page` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. madinah_pages_meta table (pages 1 to 604)
CREATE TABLE IF NOT EXISTS `madinah_pages_meta` (
    `page_number` INT NOT NULL,
    `juz_number` INT NOT NULL,
    `hizb_number` INT NOT NULL,
    `rub_el_hizb` INT NOT NULL,
    `start_surah_id` INT NOT NULL,
    `start_ayah_id` INT NOT NULL,
    PRIMARY KEY (`page_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. daily_task_logs table
CREATE TABLE IF NOT EXISTS `daily_task_logs` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `task_date` DATE NOT NULL,
    `task_type` ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH') NOT NULL,
    `start_page` INT NOT NULL,
    `end_page` INT NOT NULL,
    `completed_pages` TEXT NULL,
    `repetition_count` INT NOT NULL DEFAULT 0,
    `is_completed` BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_daily_task_logs_user_date` (`user_id`, `task_date`),
    CONSTRAINT `fk_daily_task_logs_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. mistakes table
CREATE TABLE IF NOT EXISTS `mistakes` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `page_number` INT NOT NULL,
    `surah_number` INT NOT NULL,
    `ayah_number` INT NOT NULL,
    `mistake_type` ENUM('TRANSITION_FAILURE', 'MUTASHABIHAT', 'TAWAQQUF', 'TASHKEEL', 'LAFDH') NOT NULL,
    `notes` TEXT NULL,
    `severity` TINYINT NOT NULL DEFAULT 1,
    `confused_with_surah` INT NULL,
    `confused_with_ayah` INT NULL,
    `source_task` ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH') NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `mastery_count` INT NOT NULL DEFAULT 0,
    `occurrence_count` INT NOT NULL DEFAULT 1,
    `interval_days` INT NOT NULL DEFAULT 0,
    `ease` DECIMAL(3,2) NOT NULL DEFAULT 2.50,
    `lapses` INT NOT NULL DEFAULT 0,
    `streak_correct` INT NOT NULL DEFAULT 0,
    `due_at` DATETIME NULL,
    `last_reviewed_at` DATETIME NULL,
    `graduated_at` DATETIME NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_mistakes_user_status` (`user_id`, `status`),
    KEY `idx_mistakes_user_due` (`user_id`, `status`, `due_at`),
    CONSTRAINT `fk_mistakes_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. mistake_events table (append-only review / scheduling audit trail)
CREATE TABLE IF NOT EXISTS `mistake_events` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `mistake_id` INT NULL,
    `event_type` ENUM('LOGGED','AGAIN','HARD','GOOD','EASY','MASTERED','REACTIVATED','EDITED','DELETED','UNDONE') NOT NULL,
    `grade` TINYINT NULL,
    `interval_before` INT NULL,
    `interval_after` INT NULL,
    `prev_state` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_events_user_created` (`user_id`, `created_at`),
    KEY `idx_events_mistake` (`mistake_id`),
    CONSTRAINT `fk_events_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_events_mistake`
        FOREIGN KEY (`mistake_id`) REFERENCES `mistakes` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. page_notes table (per-page recall board: the hifz's own quick-recall notes)
CREATE TABLE IF NOT EXISTS `page_notes` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `page_number` INT NOT NULL,
    `note` TEXT NULL,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_page_notes_user_page` (`user_id`, `page_number`),
    CONSTRAINT `fk_page_notes_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
