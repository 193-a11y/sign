-- 광개토환경 연차 신청 — 초기 스키마 (Postgres)
-- 시각 컬럼은 밀리초 epoch 값을 DOUBLE PRECISION 으로 저장합니다(드라이버가 숫자로 돌려줌).

CREATE TABLE employees (                          -- 근무자 명단 = 로그인 계정
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,                         -- 공백 제거·소문자
  phone_hash TEXT NOT NULL,                       -- 전화번호는 원문 저장 안 함(HMAC 값)
  phone_tail TEXT NOT NULL,                       -- 뒷 4자리(동명이인 구분 표시용)
  site TEXT,
  role TEXT,                                      -- 당직경비|미화|시설관리
  total DOUBLE PRECISION,                         -- 올해 부여 연차 (NULL = 미설정)
  used_before DOUBLE PRECISION,                   -- NULL = 0
  pw_salt TEXT,                                   -- NULL = 아직 가입 전
  pw_hash TEXT,
  pw_ver INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DOUBLE PRECISION NOT NULL,
  last_login DOUBLE PRECISION,
  UNIQUE (name_key, phone_hash)
);
CREATE INDEX idx_emp_site ON employees(site);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days DOUBLE PRECISION NOT NULL,
  wk INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  sig TEXT,
  status TEXT NOT NULL DEFAULT 'pending',         -- pending|approved|rejected|cancelled
  note TEXT NOT NULL DEFAULT '',
  cancel_req INTEGER NOT NULL DEFAULT 0,
  cancel_denied INTEGER NOT NULL DEFAULT 0,
  created_at DOUBLE PRECISION NOT NULL,
  decided_at DOUBLE PRECISION,
  decided_by TEXT
);
CREATE INDEX idx_req_emp ON requests(employee_id, status);
CREATE INDEX idx_req_created ON requests(created_at);

CREATE TABLE settings (
  skey TEXT PRIMARY KEY,
  svalue TEXT NOT NULL
);

CREATE TABLE attempts (
  kind TEXT NOT NULL,
  ip TEXT NOT NULL,
  ts DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_att ON attempts(kind, ip, ts);

CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',             -- 'super'(계정 관리 가능) | 'admin'
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_ver INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DOUBLE PRECISION NOT NULL,
  last_login DOUBLE PRECISION
);
