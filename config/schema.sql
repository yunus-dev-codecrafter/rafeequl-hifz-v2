-- Rafeequl Hifz (رفيق الحفظ) - Database Schema
--
-- Import this file into the database you created in your hosting panel.
-- It intentionally does not contain CREATE DATABASE / USE, because shared
-- hosts pre-create the database and usually forbid CREATE DATABASE.
--
-- Fresh installs: create the database, select it in phpMyAdmin, then import
-- this file. Upgrades: run config/migrate_v12.php (CLI) or use setup.php.

-- 1. users table
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `user_type` ENUM('NEW', 'EXISTING', 'COMPLETE') NOT NULL DEFAULT 'NEW',
    `role` ENUM('USER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER',
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `status_reason` VARCHAR(255) NULL,
    `suspended_at` DATETIME NULL,
    `last_login_at` DATETIME NULL,
    `last_seen_at` DATETIME NULL,
    `login_count` INT NOT NULL DEFAULT 0,
    `must_change_password` TINYINT NOT NULL DEFAULT 0,
    `current_hifz_page` INT NOT NULL DEFAULT 0,
    `daily_murajaah_target_pages` INT NOT NULL DEFAULT 100,
    `murajaah_days` INT NOT NULL DEFAULT 6,
    `rabt_extra_pages` INT NOT NULL DEFAULT 0,
    `last_tikrar_page` INT NOT NULL DEFAULT 0,
    `gate_mistake_id` INT NULL,
    `gate_mistake_locked_at` DATETIME NULL,
    `gate_waqf_id` INT NULL,
    `gate_waqf_locked_at` DATETIME NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    KEY `idx_users_role` (`role`),
    KEY `idx_users_status` (`status`),
    KEY `idx_users_last_seen` (`last_seen_at`)
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
    `task_type` ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'RUB_TAMKIN', 'MISTAKES') NOT NULL,
    `start_page` INT NOT NULL,
    `end_page` INT NOT NULL,
    `completed_pages` TEXT NULL,
    `repetition_count` INT NOT NULL DEFAULT 0,
    `rub_id` INT NULL,
    `completed_stations` TEXT NULL,
    `hifz_progress` TEXT NULL,
    `is_completed` BOOLEAN NOT NULL DEFAULT 0,
    `rollover_count` INT NOT NULL DEFAULT 0,
    `last_rollover_date` DATE NULL,
    PRIMARY KEY (`id`),
    KEY `idx_daily_task_logs_user_date` (`user_id`, `task_date`),
    KEY `idx_daily_task_logs_user_type_pending` (`user_id`, `task_type`, `is_completed`, `task_date`),
    KEY `idx_daily_task_logs_user_type_date` (`user_id`, `task_type`, `task_date`),
    CONSTRAINT `fk_daily_task_logs_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3b. rub_history table (fair random rotation for RUB_TAMKIN)
CREATE TABLE IF NOT EXISTS `rub_history` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `rub_id` INT NOT NULL,
    `last_done_date` DATE NULL,
    `times_done` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rub_history_user_rub` (`user_id`, `rub_id`),
    KEY `idx_rub_history_user_date` (`user_id`, `last_done_date`),
    CONSTRAINT `fk_rub_history_user`
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
    `mistake_type` ENUM('AYAH_MISTAKE', 'TRANSITION_FAILURE', 'MUTASHABIHAT') NOT NULL,
    `notes` TEXT NULL,
    `severity` TINYINT NOT NULL DEFAULT 1,
    `confused_with_surah` INT NULL,
    `confused_with_ayah` INT NULL,
    `source_task` ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'RUB_TAMKIN') NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `practice_count` INT NOT NULL DEFAULT 0,
    `practice_target` INT NOT NULL DEFAULT 15,
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
    KEY `idx_mistakes_user_status_practice` (`user_id`, `status`, `practice_count`),
    CONSTRAINT `fk_mistakes_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4b. waqf_flags table (exact stop-station flagged from Rub' Consolidation)
CREATE TABLE IF NOT EXISTS `waqf_flags` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `rub_id` INT NOT NULL,
    `surah_number` SMALLINT UNSIGNED NOT NULL,
    `ayah_number` SMALLINT UNSIGNED NOT NULL,
    `page_number` SMALLINT UNSIGNED NOT NULL,
    `segment_index` SMALLINT UNSIGNED NOT NULL,
    `station_key` VARCHAR(32) NOT NULL,
    `segment_text` TEXT NOT NULL,
    `stop_sign` VARCHAR(16) NULL,
    `notes` TEXT NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `practice_count` INT NOT NULL DEFAULT 0,
    `practice_target` INT NOT NULL DEFAULT 10,
    `occurrence_count` INT NOT NULL DEFAULT 1,
    `last_reviewed_at` DATETIME NULL,
    `graduated_at` DATETIME NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_waqf_flags_user_station` (`user_id`, `station_key`),
    KEY `idx_waqf_flags_user_status_practice` (`user_id`, `status`, `practice_count`),
    KEY `idx_waqf_flags_user_rub` (`user_id`, `rub_id`),
    CONSTRAINT `fk_waqf_flags_user`
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

-- 7. user_activity table (one row per user per day; drives DAU / WAU / MAU)
CREATE TABLE IF NOT EXISTS `user_activity` (
    `user_id` INT NOT NULL,
    `activity_date` DATE NOT NULL,
    `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `hits` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`user_id`, `activity_date`),
    KEY `idx_user_activity_date` (`activity_date`),
    CONSTRAINT `fk_user_activity_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. admin_audit table (append-only log of administrator actions)
CREATE TABLE IF NOT EXISTS `admin_audit` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `admin_user_id` INT NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_user_id` INT NULL,
    `details` TEXT NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_admin_audit_admin` (`admin_user_id`),
    KEY `idx_admin_audit_target` (`target_user_id`),
    KEY `idx_admin_audit_created` (`created_at`),
    CONSTRAINT `fk_admin_audit_admin`
        FOREIGN KEY (`admin_user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_admin_audit_target`
        FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. login_attempts table (brute-force throttling)
CREATE TABLE IF NOT EXISTS `login_attempts` (
    `email` VARCHAR(255) NOT NULL,
    `ip` VARCHAR(45) NOT NULL DEFAULT '',
    `attempts` INT NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`email`),
    KEY `idx_login_attempts_time` (`last_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. kalimaat_progress table (per-user معاني كلمات القرآن repetitions)
-- The word catalog itself is static content in web/data/kalimaat/.
CREATE TABLE IF NOT EXISTS `kalimaat_progress` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `word_key` CHAR(40) NOT NULL,
    `word_text` VARCHAR(190) NOT NULL,
    `meaning` TEXT NOT NULL,
    `book_name` VARCHAR(190) NULL,
    `surah_number` SMALLINT UNSIGNED NOT NULL,
    `ayah_number` SMALLINT UNSIGNED NOT NULL,
    `page_number` SMALLINT UNSIGNED NOT NULL,
    `repeat_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `status` ENUM('LOCKED','READY','MASTERED') NOT NULL DEFAULT 'LOCKED',
    `locked_at` DATETIME NULL,
    `last_repeated_at` DATETIME NULL,
    `test_attempts` INT NOT NULL DEFAULT 0,
    `test_correct` INT NOT NULL DEFAULT 0,
    `last_test_session` CHAR(40) NULL,
    `mastered_at` DATETIME NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_kalimaat_user_word` (`user_id`, `word_key`),
    KEY `idx_kalimaat_user_status` (`user_id`, `status`),
    KEY `idx_kalimaat_user_repeat` (`user_id`, `repeat_count`),
    KEY `idx_kalimaat_user_page` (`user_id`, `page_number`),
    CONSTRAINT `fk_kalimaat_progress_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Rub' consolidation session store (v12)
-- The legacy arrangement progress stays in daily_task_logs.completed_stations.
CREATE TABLE IF NOT EXISTS `rub_sessions` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `task_id` INT NOT NULL,
    `rub_id` INT NOT NULL,
    `attempt_no` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `difficulty` ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NOT NULL DEFAULT 'INTERMEDIATE',
    `status` ENUM('IN_PROGRESS','COMPLETED','ABANDONED') NOT NULL DEFAULT 'IN_PROGRESS',
    `exercises` JSON NOT NULL,
    `plan_json` JSON NOT NULL,
    `progress_json` JSON NULL,
    `sample_size` SMALLINT UNSIGNED NOT NULL DEFAULT 6,
    `allow_outside_rub` TINYINT NOT NULL DEFAULT 1,
    `correct_count` INT NOT NULL DEFAULT 0,
    `wrong_count` INT NOT NULL DEFAULT 0,
    `skipped_count` INT NOT NULL DEFAULT 0,
    `duration_seconds` INT NOT NULL DEFAULT 0,
    `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `completed_at` DATETIME NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_rub_sessions_user_task` (`user_id`, `task_id`, `status`),
    KEY `idx_rub_sessions_user_rub` (`user_id`, `rub_id`, `completed_at`),
    CONSTRAINT `fk_rub_sessions_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rub_results` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `session_id` INT NOT NULL,
    `user_id` INT NOT NULL,
    `rub_id` INT NOT NULL,
    `exercise` ENUM('WORD_ORDER','MISSING_WORDS','CONTINUE_AYAH','MUTASHABIHAT','PROGRESSIVE_HIDE','INTERRUPT','RANDOM_START','CONNECTION','REVERSE','ERROR_DETECT','NO_PREVIEW') NOT NULL,
    `item_id` VARCHAR(80) NOT NULL,
    `verse_key` VARCHAR(20) NOT NULL,
    `surah_number` SMALLINT UNSIGNED NOT NULL,
    `ayah_number` SMALLINT UNSIGNED NOT NULL,
    `difficulty` ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NOT NULL DEFAULT 'INTERMEDIATE',
    `status` ENUM('ANSWERED','SKIPPED','BOUNDARY_SKIPPED') NOT NULL DEFAULT 'ANSWERED',
    `is_correct` TINYINT NOT NULL DEFAULT 0,
    `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `duration_seconds` INT NOT NULL DEFAULT 0,
    `hint_used` TINYINT NOT NULL DEFAULT 0,
    `outside_rub` TINYINT NOT NULL DEFAULT 0,
    `details` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rub_results_item` (`session_id`, `exercise`, `item_id`),
    KEY `idx_rub_results_user_verse` (`user_id`, `rub_id`, `verse_key`),
    KEY `idx_rub_results_session` (`session_id`),
    CONSTRAINT `fk_rub_results_session`
        FOREIGN KEY (`session_id`) REFERENCES `rub_sessions` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_rub_results_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rub_verse_stats` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `rub_id` INT NOT NULL,
    `verse_key` VARCHAR(20) NOT NULL,
    `surah_number` SMALLINT UNSIGNED NOT NULL,
    `ayah_number` SMALLINT UNSIGNED NOT NULL,
    `correct_count` INT NOT NULL DEFAULT 0,
    `wrong_count` INT NOT NULL DEFAULT 0,
    `streak` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `interval_days` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `ease` DECIMAL(4,2) NOT NULL DEFAULT 2.50,
    `due_at` DATE NULL,
    `last_result` ENUM('CORRECT','WRONG') NULL,
    `last_seen_at` DATETIME NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rub_verse_stats_user_verse` (`user_id`, `rub_id`, `verse_key`),
    KEY `idx_rub_verse_stats_user_due` (`user_id`, `due_at`),
    CONSTRAINT `fk_rub_verse_stats_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rub_word_misses` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `rub_id` INT NOT NULL,
    `verse_key` VARCHAR(20) NOT NULL,
    `word_index` SMALLINT UNSIGNED NOT NULL,
    `word_text` VARCHAR(190) NOT NULL,
    `miss_count` INT NOT NULL DEFAULT 1,
    `last_missed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_rub_word_misses_user_word` (`user_id`, `rub_id`, `verse_key`, `word_index`),
    KEY `idx_rub_word_misses_user_rub` (`user_id`, `rub_id`, `miss_count`),
    CONSTRAINT `fk_rub_word_misses_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
