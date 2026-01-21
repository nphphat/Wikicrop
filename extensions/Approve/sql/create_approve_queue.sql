CREATE TABLE /*_*/approve_queue (
  aq_id INT AUTO_INCREMENT PRIMARY KEY,
  aq_page_id INT NOT NULL,
  aq_revision_id INT NOT NULL,
  aq_page_title VARBINARY(255) NOT NULL,
  aq_creator VARCHAR(255) NOT NULL,
  aq_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  aq_is_latest TINYINT(1) NOT NULL DEFAULT 1,
  aq_approver VARCHAR(255) DEFAULT NULL,
  aq_approved_at TIMESTAMP NULL DEFAULT NULL,
  aq_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aq_page (aq_page_id),
  INDEX idx_aq_status (aq_status)
) ENGINE=InnoDB;
