# 광개토환경 연차 신청 (Netlify 버전)

## 구조
- `public/` 화면 (근무자 신청 `/`, 관리자 `/admin`)
- `netlify/functions/api.mjs` API 전체 (`/api/*`)
- `netlify/database/migrations/` DB 테이블 (배포 시 자동 적용)
- `netlify.toml` 빌드·보안 헤더 설정

## 배포 체크리스트
1. 이 폴더를 GitHub(비공개 저장소 권장)에 올린다.
2. Netlify → Add new site → Import from Git → 저장소 선택 (빌드 명령 없음, 설정은 netlify.toml에 있음)
3. 사이트에서 **Netlify Database** 를 활성화한다. (첫 배포 때 migration 자동 실행)
4. Site configuration → Environment variables 등록:
   - `ADMIN_PASSWORD` : 총괄 관리자(`admin`) 첫 로그인용 비밀번호 (12자 이상)
   - `SESSION_SECRET` : 40자 이상 임의 문자열
   - `PHONE_KEY` : 40자 이상 임의 문자열 — **한 번 정하면 절대 변경 금지** (바꾸면 전화번호 대조가 전부 깨짐. 따로 보관)
   - (선택) `DUTY_MULT` : 당직경비 1회 차감일수, 기본 2
5. 환경변수 저장 후 Deploys → Trigger deploy 한 번 더.
6. 배포 후 점검
   - 접속 → 근무자 로그인 화면 표시
   - `/admin` → `admin` / ADMIN_PASSWORD 로그인 → 비밀번호 변경
   - 관리자 계정 탭에서 6~10개 생성 (최대 10개, 정지 계정도 개수에 포함)
   - 근무자 탭에서 명단 엑셀 업로드 (A열 사원명, B열 핸드폰번호)
   - 테스트 근무자로 가입→신청→승인→PDF/CSV 확인 후 테스트 데이터 정리

## 운영 규칙
- 근무자 로그인 = 이름 + 전화번호(명단 대조) → 첫 접속 때 본인 비밀번호 설정. 분실 시 관리자 화면에서 "초기화".
- 전화번호는 원문 저장 안 함 (HMAC 해시 + 끝 4자리만).
- 당직경비: 토·일·공휴일 포함, 1회 2일 차감, 반차 불가 / 시설관리·미화: 평일만.
- 공휴일은 관리자 화면에서 수정 (내장 2026~2027).
- 퇴사자는 비활성, 번호 변경은 "전화번호 변경".

## 주의 (Netlify Database 한계)
- 무료 플랜은 월 컴퓨트 시간 한도가 있고 5분 유휴 후 DB가 잠들어 첫 접속이 몇 초 느릴 수 있음. 700명 규모에서 한도를 넘으면 유료 플랜 필요.
- 서명 이미지 포함 데이터가 DB에 쌓이므로 정기적으로 관리자 화면에서 CSV 백업.

## 검증 범위
임시 Postgres(PGlite)로 API 32개 시나리오 통과, 화면 로드 확인. 실제 Netlify 배포는 미확인.
