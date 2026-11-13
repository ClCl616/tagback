# TagBack 프론트엔드

2026-11-13 develop 통합: 사용자 웹의 비회원 물품 탐색은 `GET /api/v1/catalog/item-types?keyword=...`, 직접 상세는 `/api/v1/catalog/item-types/{id}`로 연결한다. 개별 물품/태그를 노출하지 않고 서버의 종류별 전체·대여 가능 수량을 사용한다. 관리자 물품·태그 목록은 `/api/v1/admin/items`의 keyword/itemTypeId/status 검색을 사용한다. 전체 현황 및 검색 결과 수집은 10,000건 한도이며 초과 시 명시적으로 실패한다. Android 구현은 보류 중이다.

최신 통합 검증 명령(Windows PowerShell 7, Docker Desktop, Java 21, Node/pnpm 및 Windows package 준비):

```powershell
pwsh -NoProfile -File backend/scripts/test-kiosk-live.ps1 -FullJourney -AllBackendTests
```

저장소 루트에서 실행한다. 격리 PostgreSQL의 인증/물품 DB로 백엔드 전체 테스트 후 별도 live DB에서 사용자·관리자·Windows 여정을 검증한다. 포트 55439/55442/18082/5182가 비어 있어야 한다. SMS 수신함과 NFC 이벤트만 시험용이며 종료한 컨테이너와 로그는 진단용으로 보존한다.

2026-11-13 최신 추가: 공통 kiosk 빌드를 사용하는 Windows 시험 exe·설치 파일 골격을 구현했다. 실행·설정·검증 한계는 [Windows 호스트 README](../kiosk/windows/README.md)를 참고한다. 아래 P1 시점의 미구현 표시는 해당 날짜/단계의 기록이며 Android APK·실물 검증은 계속 후속 작업이다.

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
- 관리자 현황: https://localhost:5173/admin (물품 관리는 `/admin/items`)

관리자 로그인(`/admin/login`) 또는 사용자 웹에서 실제 ADMIN 계정으로 로그인한 뒤 관리자 화면에 접속한다. 두 영역은 같은 인증 API와 계정 체계를 사용한다. 기본 계정이나 초기 물품을 FE에서 만들지 않는다. 배포 환경은 동일 origin의 `/api`를 백엔드로 전달해야 한다. 백엔드 개발용 `sms-mock` 프로필은 FE mock과 별개이며 실제 문자 발송 검증을 의미하지 않는다.

## 실제 데이터 연결

### 사용자 웹 리디자인 (2026-11-06)

사용자 웹은 휴대폰 하단 메뉴와 PC 사이드바를 사용한다. 구현은 `src/mobile/UserWeb.tsx`, 범위를 제한한 스타일은 `src/mobile/user-web.css`이며 기존 인증 흐름과 HTTP 어댑터를 유지한다.

| 경로 | 화면 |
|---|---|
| `/mobile` | 비회원·회원 홈 |
| `/mobile/login`, `/mobile/signup` | 로그인·가입·SMS 인증·PIN 설정 |
| `/mobile/items` | 물품 검색·종류 필터·재고, `?item=종류ID` 상세 패널 |
| `/mobile/items/:id` | 기존 물품 상세 주소 호환 |
| `/mobile/code` | 이용 코드 명시적 발급·남은 시간·만료·재시도 |
| `/mobile/rentals`, `/mobile/rentals/:id` | 본인 대여·연체·상세 |
| `/mobile/history`, `/mobile/history/:id` | 이용 이력·검색·반납 월 필터·상세 |
| `/mobile/account` | 본인 정보·로그아웃·PIN 재설정 진입 |

코드는 버튼을 누를 때만 요청하며 화면 전환·포커스 복귀·만료 시 자동 발급하지 않는다. 응답은 세션별 메모리에서 공유하고 로그아웃·계정 변경 시 초기화한다. 서버의 기존 유효 코드 재사용 계약을 유지한다. 사용 완료 상태 조회 API가 없으므로 키오스크 사용 여부를 추정해 표시하지 않는다. 대여·반납 확정은 키오스크에서 수행한다.

사진 API가 없어 물품은 공통 아이콘으로 표시한다. 코드 QR·공지·알림·관리자 메뉴를 추가하지 않았다. 데이터 실패·빈 목록·재고 없음은 별도 상태로 표시한다. 테스트 fixture는 실행 앱의 데이터가 아니다.

리디자인 검증은 기존 인증·관리자·키오스크 회귀와 사용자 웹 코드 수명·세션 변경·목록·상세·320~1440px 반응형 테스트를 포함한다. 실제 서버·DB·문자·NFC 장치와의 통합 검증 완료를 의미하지 않는다.

- 물품·종류 조회, 물품 생성·수정·삭제, 상태와 변경 사유 저장
- 현재 태그 조회 `GET /api/items/{itemId}/tag`, UID 연결 `POST /api/items/{itemId}/tag`
- 관리자 사용자·대여 내역 조회 및 필터
- 모바일 재고·본인 대여 현황과 이력, 인증과 일회성 코드
- 키오스크 대여·반납 API와 로컬 PC/SC SSE 브리지 (`http://127.0.0.1:8765/events`)

물품 생성 후 태그 연결에 실패하면 생성된 물품을 유지하고 태그 연결만 다시 시도한다. 생성 응답이 유실되어 성공 여부가 불명확하면 재등록을 막고 목록 확인을 안내한다. 서버가 지원하지 않는 사진 업로드·별도 관리번호·종류 생성 UI는 제공하지 않는다. 현재 대여소는 설정된 한 곳이며 물품과 재고 수량은 서버 값이다.

## 검증

### 관리자 웹 리디자인 (2026-11-06)

`src/admin/AdminWeb.tsx`가 화면과 인증 경계, `AdminActions.tsx`가 물품/태그 작업과 복구, `admin-web.css`가 관리자 범위의 반응형 스타일을 담당한다. 사용자 웹과 키오스크의 진입점을 유지한다.

| 경로 | 내용 |
|---|---|
| `/admin` | 실제 전체 조회 결과로 계산한 현황, 최근 대여·연체 |
| `/admin/login`, `/admin/recover` | 공통 인증 흐름을 사용한 관리자 로그인·PIN 복구 |
| `/admin/items` | 물품 검색·필터·등록·수정·상태 변경·삭제 |
| `/admin/tags` | 태그 등록 대기 물품·연결된 물품 조회, UID 연결·복구 |
| `/admin/rentals`, `/admin/overdue`, `/admin/history` | 대여 중·연체·반납 완료 조회와 상세 |
| `/admin/users` | 사용자 조회·상세·ID 기준 관련 대여 연결 |

목록의 `q`, `status`, `kind`, `page`, `selected`, `user` 쿼리는 검색·필터·페이지·선택 대상·사용자 조건을 보존한다. 태그 미등록 분류는 서버의 TAG_PENDING 상태를 기준으로 하며 선택 시 현재 태그를 별도 조회한다. 대여 중 전체는 연체를 포함한다. 사용자 상세와 대여 상세는 기존 조회 데이터로 구성하며 반납 당시 손상 상태 등 지원하지 않는 필드는 추정하지 않는다.

ADMIN 확인 전 관리자 데이터를 요청하지 않고, 세션 만료·권한 상실·계정 변경 시 열린 상세와 초안을 제거한다. 서버 권한 검사도 그대로 필요하다. 저장 중 중복 요청을 막고 물품 생성 후 태그 연결 실패는 태그만 재시도한다. 결과가 불명확한 생성은 재전송하지 않으며 수정·상태·태그·삭제는 현재 정보를 확인하는 경로를 제공한다. 상태 조회만으로 변경 사유의 저장까지 확인했다고 표시하지 않는다.

단위 테스트와 HTTP fixture 브라우저 테스트는 실제 서비스 검증과 구분한다. 실제 DB 테스트의 선택자를 새 UI에 맞췄지만 이번 리디자인에서는 해당 DB 테스트·실제 SMS·NFC 장치를 실행하지 않았다.

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

### 키오스크 공통 UI 리디자인 (2026-11-06)

`/kiosk`에서 대기 → 대여/반납 → 최종 확인 → 서버 응답 후 완료 흐름을 제공한다. `src/kiosk/KioskApp.tsx`, `kiosk-redesign.css`, `platform.ts`가 공통 화면·상태·호스트 경계를 담당한다.

- Windows 가로 배치와 Galaxy Tab용 큰 터치 입력, 좁은 화면의 세로 배치. `/kiosk?layout=tablet`은 데스크톱에서 태블릿 레이아웃을 확인하는 용도다.
- 키패드 마지막 줄은 지우기(한 자리)·0·확인. 반납 코드는 최종 확인 화면으로 이동하며 이때 저장 요청을 전송하지 않는다. 정상/손상은 최초 미선택이다.
- 대여 예정 시간은 성공 응답의 `dueAt`만 표시한다. 현행 종류 API가 재고를 제공하지 않아 수량을 추정하지 않고 실물 인식 후 대여 가능 여부를 확인한다.
- 일반 유휴 180초, 만료 전 20초 경고, 완료 12초 후 초기화. 저장 중/결과 불명확 상태에서는 자동 초기화와 취소·이전이 차단된다.
- 복구는 같은 대여 grant·Idempotency-Key·본문 또는 같은 반납 ticket·proof·상태·코드를 재전송한다. 기존 반납 API에는 멱등 헤더를 새로 추가하지 않는다. 서버의 명확한 코드 거부를 확인하면 코드 수정으로 돌아간다.
- 외장 리더기를 한 번 구독하고 단계 외 입력은 무시한다. 브라우저 복귀 시 연결 상태와 현재 시각을 재평가하며 grant 만료를 차단한다. 반납 티켓의 최종 유효성은 서버가 판정하고 만료 시 재인식을 안내한다.

설치 호스트는 React 시작 전에 `window.tagbackKioskHost` v1을 제공할 수 있다. `platform`, `reader.subscribe`, 선택적인 `subscribeBack`, `openOperatorPanel`, `requestExit` 계약을 정의했다. Windows 기본값은 기존 localhost SSE 브리지다. Android에 호스트 리더기 어댑터가 없으면 연결 안 됨으로 표시한다. 서명 proof는 신뢰된 장치 계층이 제공하며 UI가 생성하지 않는다. 테스트의 가상 리더기는 테스트 전용이다.

관리자 운영 버튼은 `openOperatorPanel`이 제공된 호스트에서 대기 화면에만 노출한다. 호스트는 공통 서버의 ADMIN 인증·인가를 수행한 뒤 종료 등 권한 작업을 허용해야 한다. 현재 실제 운영 패널·네이티브 종료·자동 실행·업데이트·exe/APK 패키징은 구현하지 않았다. 이 인터페이스 선언을 설치 앱 완료로 해석하지 않는다.

미확인 요청 문맥은 실행 중 메모리에 보존한다. 브라우저 닫기 경고는 강제 종료를 막는 보장이 아니며, 프로세스 종료 후 복구에는 보안 저장과 서버 복구 계약의 후속 설계가 필요하다. 실제 Galaxy Tab S10+·외장 NFC 리더기·서비스 DB 검증은 별도다. 사용자 요청에 따라 리더기 지원 여부 조사는 생략했다.

### 키오스크 실제 서버·DB 검증 (2026-11-06)

Windows PowerShell 7, 실행 중인 Docker와 로컬 `postgres:17` 이미지, Java 21, Gradle 캐시, 프런트 의존성/Playwright Chromium, Git 배포 OpenSSL이 있는 환경에서 저장소 루트 기준 실행한다.

```powershell
pwsh -NoProfile -File backend/scripts/test-kiosk-live.ps1
```

스크립트는 고유 이름 `tagback-kiosk-test-<UUID>`의 전용 컨테이너를 만들고 loopback 55442에만 DB를 노출한다. `tagback_items_test`는 서버 검증, `tagback_live_test`는 브라우저 흐름용이다. 기존 DB나 운영 계정은 사용하지 않는다. 백엔드는 18082, HTTPS 프런트는 localhost:5182를 사용하며 실행 중인 포트가 있으면 중단한다. 임시 자체 서명 인증서는 테스트 디렉터리에서만 생성하고 OS 신뢰 저장소에 설치하지 않는다. 브라우저는 테스트에서만 인증서 오류를 허용한다.

서버·브라우저 테스트는 실제 API·Flyway·PostgreSQL 트랜잭션을 사용한다. SMS는 `sms-mock`, NFC는 테스트 코드의 서명 이벤트이며 실제 문자·리더기 검증이 아니다. 응답 유실은 실제 서버 요청을 완료한 뒤 브라우저 응답만 끊어 재현한다. 테스트용 비밀은 폐기 가능한 로컬 환경 전용이다.

이번 결과: 서버 10개 클래스 65개 테스트(미실행 0, 실패 0), 실제 HTTPS 브라우저 2개 테스트 통과. 브리지 자체 테스트 15개도 통과했다. 동일 코드·키의 대여 재시도, 다른 대여자 코드 거부, 거부/성공 응답 유실 복구, 잘못된 NFC 서명 거부, 정상 반납 AVAILABLE·손상 반납 INSPECTION, DB 대여/반납·상태 이력 중복 없음 등을 확인했다. `playwright.live-return.config.ts`는 반납/키오스크 파일만 실행하도록 지정해 별도 관리자 테스트가 섞이지 않는다.

소스를 바꾸지 않고 브라우저 테스트만 보강해 반복할 때는 `-SkipBackendTests`를 사용할 수 있다. 서버 변경 후에는 생략하지 않는다. 스크립트는 별도 `pwsh` 프로세스로 실행하며 환경 변수는 해당 프로세스에 한정한다. 실행 후 시작한 서버 프로세스와 DB 컨테이너를 중지하고 테스트 DB·로그는 진단용으로 보존한다. 로그 경로는 실행 끝에 출력된다. 자동 삭제하지 않는다.

현재 실물 장치 사용 불가라는 사용자 답변에 따라 Windows/갤럭시 탭 S10+ 및 외장 리더기 검증은 보류했다. 설치 앱 패키징·Android 네이티브 리더기 어댑터·운영 종료/업데이트·프로세스 재시작 복구는 후속 구현 대상이다. 사용자·관리자 웹 전체 실물 통합 검증 보류를 해제한 것은 아니다.


### Windows·Android 패키징 설계

2026-11-13 [패키징 설계 v1](../docs/kiosk-packaging-design.md)에 공통 kiosk 빌드, Electron/Java Windows 호스트, Kotlin/WebView Android 호스트, 장치별 인증, 강제 종료 복구, 운영·서명·업데이트 및 인수 기준을 기록했다. 설치 앱은 아직 구현하지 않았으며 기술 조합은 설계 기본안이다. 다음 작업은 kiosk 전용 build/host 경계 분리와 Windows 시험 exe 골격이다.


### 공통 키오스크 전용 빌드·호스트 연결 (P1, 2026-11-13)

```powershell
pnpm build:kiosk
pnpm preview:kiosk --port 5179
pnpm test:kiosk-host
```

산출물은 `dist-kiosk/kiosk-app.html`, assets, `kiosk-build.json`이다. 일반 웹 `pnpm build`의 dist와 분리한다. manifest에 HTML/JS/CSS SHA-256과 uiBuildHash, hostProtocolVersion=2/transportVersion=1을 기록한다. Windows·Android는 같은 산출물을 동봉할 수 있다. 실제 exe/APK는 아직 만들지 않았다.

설치 HTML은 시작 전에 주입된 host v2를 요구하며 일반 브라우저 preview에서는 호스트 없음 안내가 정상이다. 앱 호스트가 없거나 버전/capability가 틀리면 기존 HTTP/SSE로 우회하지 않는다. 기존 웹 `/kiosk`는 v1 reader+웹 HTTP 동작을 유지한다. 새 HTML은 Vite의 확장자 없는 탐색과 충돌하지 않도록 `kiosk-app.html`로 명명했다.

연결 타입은 `src/kiosk-host/contracts.ts`, 실행 경로 선택은 runtime.ts, 전송은 transport.ts, 키오스크 전용 업무 API는 `src/shared/kioskApi.ts`에 있다. native host는 grantHandle을 보관하고 URL·쿠키·헤더 allowlist, ADMIN 확인, 실제 장치 I/O를 자체 구현해야 한다. 메모리 기반 UNKNOWN 복구를 유지하지만 영구 저널·강제 종료 후 복구는 아직 제공하지 않는다. 상세는 [P1 호스트 계약](../docs/kiosk-host-contract.md)을 참고한다.

2026-11-13 검증: 웹/키오스크 빌드, 단위 43개, HTTP fixture 36개, 기존 kiosk 17개, 전용 빌드+가상 호스트 7개 통과. 가상 windows/android host 검사는 실제 Electron/Kotlin 앱 또는 실물 검증이 아니다. 처음 테스트 실행에 필요한 Chromium이 없으면 `pnpm exec playwright install chromium --only-shell`로 테스트 실행 파일을 설치한다.

### Windows 시험 호스트 (P2, 2026-11-13)

`../kiosk/windows`에서 `npm ci`, `npm run make`, `npm run test:smoke`를 사용한다. 공통 `dist-kiosk`를 직접 사용하므로 별도 화면 복사본은 없다. Electron/Java 동봉 exe 및 서명하지 않은 시험 Setup.exe를 생성했다. 호스트 8개/Java 17개 및 실제 패키지 실행을 확인했고 프론트엔드 단위 43개·설치 번들 7개도 재통과했다. 설정·암호화 키 입력과 실제 검증 한계는 [Windows README](../kiosk/windows/README.md). 다른 PC 설치, 실물 리더기, 영구 거래 복구, ADMIN 운영 및 Android APK는 후속 작업이다.

### 사용자 웹 → Windows exe → 관리자 웹 실제 통합 (2026-11-13)

저장소 루트에서 `./backend/scripts/test-kiosk-live.ps1 -FullJourney`를 실행한다. Docker Desktop 및 빌드된 Windows 패키지가 필요하다. 실제 서버/격리 PostgreSQL/HTTPS 웹/실제 exe를 사용하며 SMS 수신과 NFC 장치 이벤트만 시험용으로 대체한다. `-SkipBackendTests`는 backend 변경 없는 반복에만 사용한다.

최종 live 4개 통과. 가입·코드·대여·정상/손상 반납·사용자/관리자 조회와 저장 횟수를 확인했다. native health 빈 응답 처리 오류를 0.1.2에서 수정했다. 상세 범위와 로그는 [통합 검증 보고서](../docs/integration-validation-2026-11-13.md). Android 앱은 보류한다.
