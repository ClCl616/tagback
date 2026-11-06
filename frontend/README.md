# TagBack 프론트엔드

React + TypeScript + Vite. `/mobile`, `/kiosk`, `/admin`은 모두 실제 HTTP API를 사용한다. 실행용 mock DB, seed, 개발 시뮬레이터, 모드 전환 환경변수는 제거했다. API 연결 실패 시 임의 데이터로 대체하지 않는다.

## 로컬 실행

Node.js 22.12 이상과 pnpm이 필요하다. 먼저 PostgreSQL과 백엔드를 실행한다. 인증 쿠키가 Secure이므로 신뢰할 수 있는 로컬 인증서를 사용하고, 백엔드 `TAGBACK_AUTH_ALLOWED_ORIGINS`에 프론트엔드 HTTPS origin을 등록한다.

```powershell
cd frontend
pnpm install
$env:TAGBACK_API_TARGET = 'http://127.0.0.1:8080'
$env:TAGBACK_HTTPS_CERT = 'C:\certs\localhost.pem'
$env:TAGBACK_HTTPS_KEY = 'C:\certs\localhost-key.pem'
pnpm exec vite --host localhost --port 5173
```

- 모바일: https://localhost:5173/mobile
- 키오스크: https://localhost:5173/kiosk
- 통합 관리자: https://localhost:5173/admin (`/admin/items`도 같은 화면)

모바일에서 실제 ADMIN 계정으로 로그인한 뒤 관리자 화면에 접속한다. 기본 계정이나 초기 물품을 FE에서 만들지 않는다. 배포 환경은 동일 origin의 `/api`를 백엔드로 전달해야 한다. 백엔드 개발용 `sms-mock` 프로필은 FE mock과 별개이며 실제 문자 발송 검증을 의미하지 않는다.

## 실제 데이터 연결

- 물품·종류 조회, 물품 생성·수정·삭제, 상태와 변경 사유 저장
- 현재 태그 조회 `GET /api/items/{itemId}/tag`, UID 연결 `POST /api/items/{itemId}/tag`
- 관리자 사용자·대여 내역 조회 및 필터
- 모바일 재고·본인 대여 현황과 이력, 인증과 일회성 코드
- 키오스크 대여·반납 API와 로컬 PC/SC SSE 브리지 (`http://127.0.0.1:8765/events`)

물품 생성 후 태그 연결에 실패하면 생성된 물품을 유지하고 태그 연결만 다시 시도한다. 생성 응답이 유실되어 성공 여부가 불명확하면 재등록을 막고 목록 확인을 안내한다. 서버가 지원하지 않는 사진 업로드·별도 관리번호·종류 생성 UI는 제공하지 않는다. 현재 대여소는 설정된 한 곳이며 물품과 재고 수량은 서버 값이다.

## 검증

```powershell
pnpm build
pnpm test
pnpm test:e2e
pnpm exec playwright test -c playwright.bridge.config.ts
```

단위·브라우저 회귀 테스트의 응답 fixture와 장애 주입은 테스트 전용이다. 앱 런타임에 포함되지 않는다. 실제 장치 검증은 별도로 수행해야 한다.

실제 DB 관리자 검증은 **폐기 가능한 전용 PostgreSQL 컨테이너**의 `tagback_live_test` DB와 해당 DB를 사용하는 백엔드(18085)가 필요하다. 테스트는 사용자를 가입시키고 관리자 권한을 부여하며 물품·종류를 생성하므로 운영 DB에서 실행하지 않는다. 백엔드 origin에 `https://localhost:5185`를 허용한다.

```powershell
$env:TAGBACK_TEST_CONTAINER = '<전용 테스트 컨테이너 이름>'
# 위 HTTPS 인증서 환경변수도 설정
pnpm exec playwright test -c playwright.admin-live.config.ts
```

실제 DB 검증 범위: USER 접근 차단, 등록·수정·삭제, 태그 조회·중복 연결, 상태 이력, 새로고침 후 유지, 생성 응답 유실 시 중복 등록 방지. backend의 개발용 SMS 수신 API를 사용한다.
