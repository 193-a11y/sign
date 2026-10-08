-- 로그인 없는 신청 방식: 학교 목록 + 신청서에 신청자 정보 직접 저장
CREATE TABLE schools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DOUBLE PRECISION NOT NULL
);

ALTER TABLE requests ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE requests ADD COLUMN school TEXT;
ALTER TABLE requests ADD COLUMN name TEXT;
ALTER TABLE requests ADD COLUMN phone TEXT;
ALTER TABLE requests ADD COLUMN job TEXT;
ALTER TABLE requests ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_req_school ON requests(school);
