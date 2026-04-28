-- Create and use your database first in phpMyAdmin if needed:
-- CREATE DATABASE counselling_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE counselling_db;

CREATE TABLE IF NOT EXISTS trainees (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_number VARCHAR(40) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  program_name VARCHAR(120) NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  razorpay_order_id VARCHAR(80) NOT NULL,
  razorpay_payment_id VARCHAR(80) NOT NULL,
  razorpay_signature VARCHAR(255) NOT NULL,
  payment_status ENUM('paid','failed','refunded') NOT NULL DEFAULT 'paid',
  registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trainees_receipt_number (receipt_number),
  UNIQUE KEY uq_trainees_order_id (razorpay_order_id),
  UNIQUE KEY uq_trainees_payment_id (razorpay_payment_id),
  KEY idx_trainees_email (email),
  KEY idx_trainees_program (program_name),
  KEY idx_trainees_registered_at (registered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS program_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_name VARCHAR(180) NOT NULL,
  contact_person VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  requested_program VARCHAR(150) NOT NULL,
  participants_estimate INT UNSIGNED DEFAULT NULL,
  preferred_date DATE DEFAULT NULL,
  message TEXT,
  status ENUM('new','reviewed','approved','rejected') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_program_requests_status (status),
  KEY idx_program_requests_created_at (created_at),
  KEY idx_program_requests_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  starts_at DATETIME DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notices_active_priority (is_active, priority),
  KEY idx_notices_dates (starts_at, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional seed data:
INSERT INTO notices (title, body, is_active, priority, starts_at, expires_at)
SELECT 'New Batch Open', 'Registrations are now open for the Emotional Wellness Certification.', 1, 10, NOW(), DATE_ADD(NOW(), INTERVAL 45 DAY)
WHERE NOT EXISTS (SELECT 1 FROM notices WHERE title = 'New Batch Open');
