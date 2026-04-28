-- Run this in phpMyAdmin if your trainees table already exists from older Razorpay schema.

ALTER TABLE trainees
  MODIFY receipt_number VARCHAR(40) NULL,
  ADD COLUMN manual_txn_id VARCHAR(120) NULL AFTER currency,
  ADD COLUMN payment_proof_path VARCHAR(255) NULL AFTER manual_txn_id,
  ADD COLUMN verified_at DATETIME NULL AFTER payment_proof_path,
  ADD COLUMN verified_by VARCHAR(120) NULL AFTER verified_at,
  MODIFY payment_status ENUM('pending','proof_submitted','paid','rejected','refunded') NOT NULL DEFAULT 'pending';

-- Drop Razorpay-specific columns only if they exist.
ALTER TABLE trainees
  DROP COLUMN razorpay_order_id,
  DROP COLUMN razorpay_payment_id,
  DROP COLUMN razorpay_signature;

-- Recreate indexes for new flow.
ALTER TABLE trainees
  DROP INDEX uq_trainees_order_id,
  DROP INDEX uq_trainees_payment_id,
  ADD UNIQUE KEY uq_trainees_manual_txn_id (manual_txn_id),
  ADD KEY idx_trainees_payment_status (payment_status);
