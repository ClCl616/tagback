# 카카오 OAuth 인증 전환

2026-11-27 · 구현 기준 `origin/codex/ui-ux-refinement`의 `301d538` · 별도 `codex/kakao-oauth` 브랜치.
PR #33의 `3734164`는 참조만 했으며 챗봇·탈퇴 정책을 가져오지 않았다. 기존 사용자·관리자·키오스크 UI를 기준으로 인증 화면만 교체했다.

## 현재 흐름

- 최초 이용: 카카오 로그인·닉네임 제공 동의 → 닉네임 자동 입력 및 수정, 직업(학생/교직원/기타) 선택 → 가입 완료.
- 재로그인: 같은 카카오 앱 사용자 ID로 기존 서비스 계정을 찾는다. 닉네임은 식별자도 실명 증명도 아니다. 실명 기준 1인 1계정을 보장하지 않는다.
- 재방문: 유효한 HttpOnly 서비스 세션이면 바로 이용. 무활동 30분 또는 절대 8시간 만료 후 카카오 로그인. 기존 한 계정의 단일 활성 브라우저 정책은 유지한다.
- 로그인용 6자리 PIN, 설정·확인·재설정, 전화번호/SMS 로그인·가입 API와 UI를 제거했다. `/mobile/recover`, `/mobile/change-phone`은 로그인으로 이동한다.
- 키오스크 대여·반납 6자리 이용 코드는 변경하지 않는다. 공통 관리자 비밀번호와 관리자 쿠키도 별개로 유지한다.
- 카카오싱크, 실명·전화번호 권한, 챗봇 인증, 인증번호 자동 발송, Event API, 탈퇴 기능은 구현 범위에 없다.

## API 계약

경로 접두어 `/api/v1/auth`. 쓰기 요청은 JSON 및 허용 Origin 검사를 사용한다. 모든 인증 응답은 캐시 금지다.

| 경로 | 동작 |
| --- | --- |
| `POST /kakao/start` | `{next, switchAccount: false}`. 기존 서비스 세션 및 이전 OAuth 흐름 종료, 일회용 state 및 브라우저 쿠키 생성. `{url}` 반환. 프론트는 고정 `https://kauth.kakao.com/oauth/authorize` 주소만 허용. `switchAccount: true`는 `prompt=login`으로 다른 계정 인증을 명시적으로 요청. |
| `GET /kakao/callback` | 서버에서 state·브라우저 쿠키·10분 만료·일회성 확인 후 인가 코드 교환 및 `/v2/user/me` 호출. 새 계정은 `/mobile/signup`, 기존 계정은 세션 발급 후 허용한 사용자 화면으로 303. 취소·실패는 일반화한 로그인 안내로 이동. |
| `GET /kakao/pending` | 브라우저에 묶인 검증된 흐름의 `{needsSignup,nickname,next,userId}`. 카카오 ID나 토큰을 클라이언트 입력으로 받지 않는다. |
| `POST /kakao/complete` | `{name,occupation}`. 신규 계정은 프로필 검사 후 저장. 이미 가입된 ID는 프로필을 덮어쓰지 않고 로그인. `{next,userId}`와 새 세션 쿠키 반환. 프론트는 세션을 다시 조회하고 반환된 userId와 일치하는지 확인한다. |
| `GET /session` | 기존 서비스 세션 계약 유지. 상태 조회로 만료를 연장하지 않는다. 카카오 계정의 `maskedPhoneNumber`는 빈 문자열이다. |
| `POST /session/activity` | 실제 사용자 동작에만 무활동 만료 연장. 절대 만료를 넘지 않는다. |
| `POST /logout` | 서비스 세션과 해당 OAuth 흐름 폐기, 서비스·옛 브라우저·OAuth 쿠키 제거. 카카오 웹사이트 자체의 로그인 쿠키까지 해제하는 동작은 아니다. |

`/signup`, `/login/phone`, `/login/registered`, `/login/new-browser`, `/pin/reset`, `/sms/*`, `/browser-registration` 컨트롤러는 없다. 이전 SMS/PIN API 문서는 이 브랜치의 현행 계약이 아니다.

## 보안·복구 동작

state와 브라우저 토큰은 각각 256비트 난수이며 DB에는 SHA256만 보관한다. `__Host-tagback-oauth`, `__Host-tagback-session` 쿠키는 Secure, HttpOnly, SameSite=Lax, Path=/이고 Domain을 설정하지 않는다. 로컬에서도 HTTPS가 필요하다. 돌아갈 주소는 `/mobile`의 명시한 화면만 허용하며 서버 설정의 callback URI를 사용한다. 요청 Host로 callback을 만들지 않는다.

인가 코드는 외부 요청 전에 DB에서 한 번만 소비한다. 제공자 타임아웃·오류·잘못된 JSON·토큰 타입·만료·잘못된 사용자 ID·닉네임 동의 누락은 로그인 실패로 처리하고 원문 응답을 출력하지 않는다. 고정 HTTPS 제공자 주소에만 요청하고 HTTP redirect를 따르지 않는다. 액세스/리프레시 토큰은 DB·브라우저 저장소·로그에 남기지 않는다. 제공자 액세스 토큰은 사용자 조회에만 사용하고 서비스 로그인에는 별도 세션을 발급한다.

가입 저장과 세션 발급은 하나의 DB 트랜잭션이다. PostgreSQL advisory lock과 `users.kakao_user_id UNIQUE`로 여러 브라우저의 동시 가입을 직렬화한다. 완료 응답 유실 시 같은 흐름으로 재시도해도 계정은 하나이고 프로필은 처음 저장된 값으로 유지된다. 세션은 재시도 때 회전한다. 새로고침 후 이미 가입된 계정이면 `로그인 계속`을 제공한다. 흐름 만료·쿠키 유실이면 카카오 로그인을 다시 시작한다. 소비한 callback URL을 재사용하지 않는다.

로그아웃·계정 전환은 이전 흐름의 진행 중 가입 완료 트랜잭션을 기다린 뒤 그 흐름의 세션을 폐기한다. 따라서 늦게 도착한 이전 계정 쿠키 응답으로 그 계정을 다시 사용할 수 없다. 새 로그인은 기존 단일 브라우저 세션을 교체한다. 흐름 시작은 분당 IP 30회/전체 300회로 제한하며 요청 주소에 임의 X-Forwarded-For를 신뢰하지 않는다. 프록시 환경에서 IP 제한은 프록시 주소 기준일 수 있으므로 실제 배포 토폴로지에 맞게 검토한다.

Nginx 로그는 `$request` 대신 `$uri`만 기록해 callback의 code/state 쿼리와 Referer를 남기지 않는다. 별도 운영 프록시·APM에도 같은 정책을 적용해야 한다. 완료된/만료된 OAuth 임시 행은 다음 로그인 시작 때 만료 기준으로 정리한다.

## 기존 데이터 및 키오스크 호환성

V22는 기존 V1~V21을 수정하지 않고 추가한다. 기존 user_id, 전화번호, 해시, 대여·반납·점검 이력 및 외래키를 유지하고 전화번호 nullable, 카카오 ID UNIQUE, OAuth 임시 테이블, 세션 흐름 추적 컬럼만 추가한다. 과거 PIN 컬럼·SMS 테이블과 일부 ORM 모델은 이전 데이터/마이그레이션 호환용이며 PIN 인증 기능은 제공하지 않는다.

**기존 전화번호 계정은 자동 연결하지 않는다.** 카카오 닉네임이 같아도 별도 계정이다. 기존 사용자의 대여 이력을 새 카카오 로그인에서 사용하려면 운영 전, 사용자를 확인할 별도 연결 정책을 정하고 기존 user_id에 검증한 카카오 ID를 연결해야 한다. 이 작업의 코드에는 관리자 임의 계정 병합/전환 API를 넣지 않았다. 이 연결 확인 없이 기존 대여자를 새 계정으로 전환하면 기존 대여의 소유권 확인 및 반납 코드가 맞지 않을 수 있으므로 실제 데이터 전환 준비를 먼저 해야 한다. 운영 데이터를 비우는 방식으로 해결하지 않는다.

`/kiosk/rental-grants`는 기존 `token`, `expiresAt`, `maskedPhoneNumber` 문자열 계약을 유지한다. 카카오 계정은 전화번호가 없으므로 호환 표시값 `카카오 이용자`를 보낸다. 키오스크의 이용 코드, grant, NFC proof, 대여·반납 멱등키 계약과 앱 UI는 유지한다. 마이그레이션을 적용한 DB에 이전 백엔드를 단순 재배포하면 nullable 전화번호를 처리하지 못할 수 있으므로 구버전으로의 즉시 롤백을 가정하지 않는다.

PR #33은 별도 V22 이후 마이그레이션을 가진 대안 브랜치다. 그 브랜치의 DB에 이 V22를 적용하거나 두 분기를 그대로 합치지 않는다. 그런 DB가 있다면 먼저 마이그레이션 충돌과 계정 정책을 별도로 검토한다.

## 실제 연결을 위한 최소 설정

현재 작업 환경에 카카오 도구/커넥터, `KAKAO_*` 자격정보 환경변수, 이 worktree의 실제 비밀 설정이 없다. 제공자 fixture 시험을 실제 로그인 검증으로 간주하지 않는다.

1. 카카오디벨로퍼스에서 이 프로젝트용 앱의 카카오 로그인을 활성화하고 닉네임(`profile_nickname`) 동의항목을 설정한다. 사업자/카카오싱크·실명·전화번호 권한은 요청하지 않는다.
2. 사용할 **같은 앱**의 REST API 키와 활성화한 클라이언트 시크릿을 준비한다. 시크릿을 채팅·Git에 보내지 말고 로컬/서버 비밀 설정에 직접 넣는다.
3. 정확한 HTTPS redirect URI를 등록한다. 예: 로컬 `https://localhost:8443/api/v1/auth/kakao/callback`. 운영 주소를 사용할 때는 `https://tagback.chiro1.cloud/api/v1/auth/kakao/callback`이지만 이번 변경은 운영에 배포하지 않았다.
4. 서버에 `tagback.kakao.client-id`, `tagback.kakao.client-secret`, `tagback.kakao.redirect-uri`, `tagback.auth.hash-key` 및 허용 Origin을 설정한다. 기존 이용 코드 HMAC 키는 그대로 유지한다. `tagback.auth.sms-hash-key`는 기존 키 설정을 보존하기 위한 별칭이다. 빈 키로는 로그인 시작/이용 코드 기능을 사용할 수 없다. 실행 앱에는 알려진 개발용 기본 HMAC 키를 넣지 않으며 고정 시험 키는 test resources에만 둔다. 카카오 앱을 변경하면 사용자 ID의 의미가 달라지므로 같은 앱 설정을 유지하고 앱 교체는 별도 데이터 전환으로 다룬다.
5. Compose는 `.env`의 `KAKAO_CLIENT_ID`, `KAKAO_REDIRECT_URI`와 Git 제외 파일 `deploy/compose/local/kakao-client-secret`을 읽는다. 기존 `local/sms-hash-key` 파일을 새 auth.hash-key로 주입하므로 키를 재생성하지 않는다. 초기화 스크립트는 카카오 자격정보를 만들지 않는다. OAuth·세션·대여 API는 이제 SMS 시험 프로필 없이 동작한다.
6. 격리 HTTPS 환경에서 최초 동의/수정 닉네임/재로그인/카카오 취소/다른 계정/로그아웃/쿠키 차단/만료를 실제 카카오 계정으로 확인한다. 배포 전 기존 계정 연결, DB 백업·복구 및 운영 프록시 로그 정책도 확인한다.

공식 근거(2026-11-27 확인): [카카오 로그인 REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [카카오 로그인 설정](https://developers.kakao.com/docs/latest/ko/kakaologin/prerequisite). 서버 코드 교환→사용자 조회, state, profile_nickname, prompt 및 클라이언트 시크릿 계약을 확인했다.

## 검증 방법

- `pnpm --dir frontend install --frozen-lockfile`
- `pnpm --dir frontend build`, `build:kiosk`, `test`, `test:http`
- `pnpm --dir frontend exec playwright test -c playwright.bridge.config.ts`
- `backend/scripts/test-oauth-postgres.ps1`: 로컬 Docker의 새로운 PostgreSQL 17 컨테이너 3개만 사용, 127.0.0.1:55439/55440/55461이 사용 중이면 중단, 운영 볼륨을 마운트하지 않고 종료 후 해당 시험 컨테이너 제거. Gradle 의존성은 offline 캐시 필요.

OAuth 테스트는 제공자를 Mockito/HTTP fixture로 대체한다. 서버→카카오 HTTP 요청 직렬화·응답 검증, PostgreSQL migration/동시 가입/세션/CSRF/취소/재시도/기존 대여 FK, 브라우저 UI와 키오스크 회귀를 각각 구분한다. 과거 SMS/PIN 전용 테스트는 삭제하고 OAuth 테스트로 대체했다. 기존 관리자 DB 테스트는 공통 비밀번호 관리자 세션 기준으로 고쳤다. 실제 카카오 계정·운영 DB·실물 NFC·설치 앱 재패키징·운영 배포는 미검증/미수행이다.

## 2026-11-27 실행 결과

| 검증 | 결과 |
| --- | --- |
| 웹 build / kiosk build | 통과 |
| 프론트 Vitest | 40개 통과 |
| 사용자·관리자 HTTP browser fixture | 33개 통과 |
| 키오스크 bridge browser fixture | 17개 통과 |
| 격리 PostgreSQL 포함 서버 전체 | 276개 통과, skip 0 (OAuth 단위/HTTP client/DB 15개 포함) |
| Compose 설정 해석 / git diff 공백 검사 | 통과 |
| 실제 카카오 계정·운영 서버·실물 NFC·설치 앱 | 미검증, 운영 배포 없음 |

최종 브라우저 시험에서 수정 닉네임의 응답 유실/재시도 및 새로고침 후 기존 가입의 로그인 재개를 확인했다. 390px 가입 화면 렌더와 320~1440px 사용자·관리자 회귀 검사를 확인했다. 서버 시험은 새 임시 컨테이너에만 데이터를 만들고 시험 종료 시 해당 컨테이너를 정리했다. 중간 실행에서 발견한 관리자 테스트의 구형 세션 가정과 HTTP client mock 작성 오류를 수정한 뒤 재검증했다.
