-- NAS 자동 변환 테스트용 테이블 (v7.1 명세 적용)
-- MySQL 환경에서 실행해주세요.

-- 1. 메타데이터 상태 저장 테이블
CREATE TABLE IF NOT EXISTS file_convert_metadata (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- 분류
  domain_type           VARCHAR(50) NULL,
  domain_id             INT NULL,

  -- 원본
  original_path         VARCHAR(500) NOT NULL,
  original_name         VARCHAR(300) NOT NULL,
  original_ext          VARCHAR(20) NOT NULL,
  original_size         BIGINT NOT NULL,
  mime_type             VARCHAR(100) NOT NULL,
  content_hash          VARCHAR(64) NULL,
  etag                  VARCHAR(100) NULL,

  -- 변환 결과
  converted_path        VARCHAR(500) NULL,
  converted_name        VARCHAR(300) NULL,
  converted_ext         VARCHAR(20) NULL,
  converted_size        BIGINT NULL,
  converted_hash        VARCHAR(64) NULL,
  converted_etag        VARCHAR(100) NULL,

  -- 상태
  convert_status        ENUM('uploaded','processing','uploading','completed','failed','skipped')
                        DEFAULT 'uploaded',
  convert_job_id        VARCHAR(100) NULL,
  convert_error         TEXT NULL,
  retry_count           INT DEFAULT 0,
  failure_type          ENUM('retryable','permanent','stuck') NULL,
  worker_id             VARCHAR(50) NULL,

  -- DB 락
  locked_at             DATETIME NULL COMMENT 'Worker 락 시각',

  -- v7.1: NAS temp 파일 추적
  temp_upload_path      VARCHAR(500) NULL COMMENT 'NAS 업로드 중 임시 경로 (.__uploading__)',

  -- 타임스탬프
  created_at            DATETIME DEFAULT NOW(),
  updated_at            DATETIME DEFAULT NOW() ON UPDATE NOW(),
  processing_started_at DATETIME NULL,
  uploading_started_at  DATETIME NULL,
  completed_at          DATETIME NULL,
  last_retry_at         DATETIME NULL,

  UNIQUE KEY uniq_content_hash (content_hash),
  INDEX idx_status (convert_status),
  INDEX idx_domain (domain_type, domain_id),
  INDEX idx_stuck (convert_status, updated_at),
  INDEX idx_lock (convert_status, locked_at),
  INDEX idx_created (created_at),
  INDEX idx_zombie (convert_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 변환 로그 관리용 테이블 (7일마다 자동 삭제)
CREATE TABLE IF NOT EXISTS convert_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  metadata_id BIGINT NULL,
  level       ENUM('error','warn','info') NOT NULL,
  message     VARCHAR(500) NOT NULL,
  detail      TEXT NULL,
  created_at  DATETIME DEFAULT NOW(),
  
  INDEX idx_meta (metadata_id),
  INDEX idx_level_time (level, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
