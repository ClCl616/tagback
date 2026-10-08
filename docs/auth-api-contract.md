# 모바일 프론트 ↔ 인증 API 계약

기준: `develop`의 `sms-mock` 서버 API와 `frontend/src/shared/httpAuth.ts`의 HTTP 어댑터. `VITE_AUTH_MODE=http`에서 아래 인증 API를 호출하며, 미설정 시 기존 브라우저 Mock을 사용한다. 이 문서는 필드·오류·재시도 규칙과 아직 연결하지 않은 흐름을 정한다. 서버의 인증 컨트롤러는 `sms-mock` 프로필에서만 활성화되며 운영 SMS 공급자는 연결되지 않았다.

## SMS 용도와 화면

| 화면/동작 | 서버 `SmsPurpose` | 결정 |
|---|---|---|
| 신규 가입 전화번호 확인 | `SIGNUP` | 프론트 mock의 `access` 중 **가입**에 해당한다. |
| PIN 찾기/재설정 | `PIN_RESET` | 프론트 mock의 `reset`. 등록된 번호에만 요청 가능하다. 인증 토큰으로 PIN을 변경한다. |
| 기존 회원 전화번호+PIN 로그인 | SMS 없음 | `POST /login/phone`으로 로그인한다. |
| 서버의 구형 새 브라우저 로그인 | `LOGIN` | `/login/new-browser`가 이 용도 토큰을 요구하지만 위 화면 정책에는 사용하지 않는다. |
| 전화번호 변경 | `PHONE_CHANGE` | 프론트 mock의 `change`. 현재 서버의 SMS 요청은 `REAUTHENTICATION_REQUIRED`로 차단하며 변경 API도 없다. |

`source`와 `reauth`는 프론트 mock 내부 인자다. 현재 SMS 요청 JSON에는 넣지 않는다. 프론트의 `existing`·`needsPin`도 서버 SMS 확인 응답에는 없다. 인증 결과만으로 계정 존재 또는 PIN 설정 상태를 추정하지 않는다. 가입 시 기존 번호 판단은 `PHONE_NUMBER_ALREADY_REGISTERED`, 기존 계정의 PIN 미설정/잠금 판단은 로그인 오류로 처리한다.

## HTTP 요청과 응답

모든 경로는 `/api/v1/auth` 기준이다. JSON 요청에는 `Content-Type: application/json`을 사용한다. 아래의 `Idempotency-Key`는 임의 UUID 문자열이며, **논리적으로 하나의 작업에 하나**를 발급한다.

| 작업 | HTTP | 요청 JSON / 헤더 | 성공 응답 |
|---|---|---|---|
| SMS 발급 | `POST /sms/requests` | `{ "phoneNumber": "01012345678", "purpose": "SIGNUP" }`, `Idempotency-Key` | `202 { "requestId": "UUID", "expiresAt": "2026-10-06T09:05:00Z", "resendAvailableAt": "2026-10-06T09:01:00Z" }` |
| SMS 확인 | `POST /sms/verifications` | `{ "requestId": "UUID", "code": "123456" }` | `200 { "verificationToken": "opaque", "purpose": "SIGNUP", "expiresAt": "2026-10-06T09:10:00Z", "maskedPhoneNumber": "010-****-5678" }` |
| 가입 | `POST /signup` | `{ "verificationToken": "opaque", "pin": "048259", "profile": { "name": "홍길동", "occupation": "학생" } }`, `Idempotency-Key` | `201 LoginResult`, 세션·브라우저 쿠키 발급 |
| 전화번호+PIN 로그인 | `POST /login/phone` | `{ "phoneNumber": "01012345678", "pin": "048259" }`, `Idempotency-Key` | `200 LoginResult`, 세션·브라우저 쿠키 발급 |
| 등록 브라우저 로그인 | `POST /login/registered` | `{ "pin": "048259" }`, 브라우저 쿠키, `Idempotency-Key` | `200 LoginResult`, 세션·브라우저 쿠키 발급 |
| 서버의 구형 새 브라우저 로그인 | `POST /login/new-browser` | `{ "verificationToken": "LOGIN 용도 opaque", "pin": "048259" }`, `Idempotency-Key` | `200 LoginResult` + `previousBrowserRevoked: boolean`, 세션·브라우저 쿠키 발급. 현재 화면에는 연결하지 않는다. |
| PIN 재설정 | `POST /pin/reset` | `{ "verificationToken": "opaque", "pin": "246802" }`, `Idempotency-Key` | `200 { "completed": true }`, 세션·브라우저 쿠키 삭제 |
| 브라우저 상태 | `GET /browser-registration` | 브라우저 쿠키 | `200 { "registered": boolean, "maskedPhoneNumber": string\|null, "expiresAt": ISO\|null }` |
| 세션 상태 | `GET /session` | 세션 쿠키 | `200 { "authenticated": true, "user": UserSummary, "sessionExpiresAt": ISO }` 또는 인증 오류 |
| 실제 활동 기록 | `POST /session/activity` | 세션 쿠키 | `200 SessionStatus`. 사용자 활동에만 호출한다. |
| 로그아웃 | `POST /logout` | 세션 쿠키 | `204`, 세션 쿠키만 삭제 |
| 등록 해제 | `DELETE /browser-registration` | 세션·브라우저 쿠키 | `204`, 두 쿠키 삭제 |

`LoginResult`는 `{ "user": { "userId": "문자열", "maskedPhoneNumber": "010-****-5678", "role": "USER", "name": "홍길동", "occupation": "학생" }, "sessionExpiresAt": ISO, "browserRegistrationExpiresAt": ISO }`다. 기존 계정의 `name`·`occupation`은 `null`일 수 있다. `sessionExpiresAt`은 무활동 만료 시각이며 세션의 절대 만료 시각은 응답에 없다. `userId`는 숫자처럼 보여도 문자열로 취급한다. 입력 전화번호는 서버가 `010` 11자리 또는 `+8210` 형식을 정규화한다. 응답에 SMS 코드나 원문 전화번호는 없다. `verificationToken`은 일회성 비밀값이며 용도·번호가 서버에서 검증된다.

| 프론트 mock `AuthAdapter` | 서버 HTTP 필드/동작 |
|---|---|
| `Challenge.id` | `SmsRequested.requestId` |
| `Challenge.expiresAt`, `resendAt` (숫자 ms) | `expiresAt`, `resendAvailableAt` (ISO 문자열) |
| `Verification.proof` | `SmsVerified.verificationToken` |
| `Verification.maskedPhone`, `expiresAt` | `maskedPhoneNumber`, ISO `expiresAt` |
| `Verification.existing`, `needsPin` | 서버 확인 응답에 없음. 가입·로그인 결과/오류로 분기 |
| `LoginResult.token`, `registration` | JSON에 없음. HttpOnly 세션·브라우저 쿠키로 대체 |
| `AuthAdapter.result(id)` | 서버 조회 API 없음. 동일 키 재시도 규칙 적용 |

가입 화면의 `name`·`occupation`은 서버 `/signup` 요청에 필수이며 앞뒤 공백을 제거해 각각 최대 40자로 저장한다. `LOGIN` 토큰을 쓰는 `/login/new-browser`는 현재 서버 기능이지만, 이번 전화번호+PIN 화면의 대체 경로로 사용하지 않는다.

## 시각과 쿠키

- 서버의 `Instant`는 `Z` 또는 UTC 오프셋이 있는 ISO 8601 문자열이다. 프론트는 `Date.parse(value)`로 **epoch milliseconds**로 바꿔 기존 타이머에 사용한다. 숫자 밀리초를 HTTP JSON으로 보내거나 받지 않는다. `retryAt`도 같은 형식이다.
- 현재 서버 기본값은 SMS 코드 5분, 재발송 1분, 인증 토큰 10분, 세션 무활동 30분/절대 8시간, 브라우저 등록 30일, 번호별 SMS 24시간 10회다. 프론트 mock의 세션 절대 24시간·번호별 1시간 10회와 다르다. HTTP 화면은 mock 상수를 적용하지 않고 서버가 준 만료/대기 시각과 오류를 따른다.
- 성공한 인증 응답은 `Cache-Control: no-store`다. `verificationToken`은 다음 요청에만 사용하고 로그·영구 저장소에 남기지 않는다.
- 서버가 설정하는 쿠키는 `__Host-tagback-session`과 `__Host-tagback-browser`다. 둘 다 `Secure; HttpOnly; SameSite=Lax; Path=/`이며 브라우저가 관리한다. 프론트는 토큰 값을 읽거나 `localStorage`에 복사하지 않는다. HTTP 어댑터는 같은 origin에서 `credentials: 'include'`를 사용한다. 쿠키를 발급·변경하는 요청과 로그아웃 등은 서버의 Origin 검사를 통과해야 한다.
- 로그인/가입은 두 쿠키를 발급한다. 로그아웃은 세션 쿠키만 지워 등록을 유지한다. PIN 재설정과 등록 해제는 둘 다 지운다. 등록 여부는 브라우저 상태 API로, 로그인 여부는 세션 상태 API로 확인한다.

## 오류 계약

실패 본문은 `{ "error": { "code": "SMS_RESEND_WAIT", "message": "재발송까지 기다려 주세요.", "retryAt": "2026-10-06T09:01:00Z" } }` 형태다. `retryAt`은 대기 오류 외에는 `null`일 수 있다. 화면 분기는 문구가 아니라 `error.code`로 한다.

| 화면 처리 | 서버 코드 |
|---|---|
| 입력 수정 | `INVALID_INPUT`, `PIN_POLICY_VIOLATION`, `PIN_MISMATCH` |
| SMS 번호 재입력/재발송 | `SMS_CODE_MISMATCH`, `SMS_CODE_EXPIRED`, `SMS_ATTEMPTS_EXCEEDED`, `SMS_REQUEST_INVALIDATED`, `SMS_ALREADY_VERIFIED`, `SMS_DELIVERY_FAILED` |
| `retryAt`까지 대기 | `SMS_RESEND_WAIT`, `SMS_REQUEST_LIMIT_EXCEEDED`, `PIN_RETRY_WAIT` |
| SMS부터 다시 확인 | `VERIFICATION_INVALID`, `VERIFICATION_EXPIRED`, `VERIFICATION_CONSUMED`, `VERIFICATION_PURPOSE_MISMATCH` |
| PIN 찾기 안내 | `PIN_LOGIN_BLOCKED` |
| 계정/브라우저 분기 | `ACCOUNT_NOT_FOUND`, `PHONE_NUMBER_ALREADY_REGISTERED`, `BROWSER_REGISTRATION_INVALID` |
| 인증 해제 후 로그인 | `SESSION_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REPLACED`, `REAUTHENTICATION_REQUIRED` |
| 접근 거부 | `FORBIDDEN` |
| 같은 작업 키 사용 오류 | `IDEMPOTENCY_KEY_CONFLICT` |

프론트 mock의 `SMS_WAIT`, `SMS_USED`, `PIN_LOCKED`, `SMS_REQUIRED`, `AUTH`, `DUPLICATE`, `UNKNOWN` 등은 HTTP 코드가 아니다. HTTP 어댑터에서는 위 서버 코드를 해석해 화면 상태로 바꾸며, mock 오류 문자열을 서버에 요구하지 않는다. 알 수 없는 오류는 성공으로 처리하지 않는다.

## 응답 유실과 재시도

1. SMS 발급, 가입, 등록/새 브라우저 로그인, PIN 재설정은 요청 **직전에** UUID를 만들고, 결과가 불명확하면 동일한 `Idempotency-Key`와 **완전히 같은 본문**으로 재시도한다. 새 키를 만들거나 PIN을 바꿔 보내지 않는다. SMS 발급 재시도는 같은 `requestId`를 돌려주며 새 문자를 보내지 않는다. 실제 재발송을 원하면 1분 대기 뒤 새 키로 요청한다. 기존 키는 코드가 만료되어도 이전 요청을 재생할 수 있다.
2. 가입·로그인 재시도는 기존 세션이 유효한 동안 같은 결과와 쿠키를 재발급한다. PIN 재설정 재시도는 원래 인증 결과의 만료 전까지 `completed: true`를 다시 돌려준다. 만료 또는 키 충돌 시에는 오류를 따르고 새 인증을 시작한다.
3. SMS **확인**은 현재 멱등 재생 API가 없다. 확인 응답이 유실되어 `verificationToken`을 받지 못했다면 같은 코드를 무한 재시도하지 않는다. 이미 확인된 요청은 `SMS_ALREADY_VERIFIED`가 되므로, 재발송 대기 이후 새 SMS를 발급받아 다시 확인한다.
4. 프론트 mock의 `result(operationId)` 조회와 `UNKNOWN` 오류는 서버에 대응 경로가 없다. HTTP 전환 시 같은 키 재시도를 사용한다. 새로고침으로 원래 PIN/본문을 잃었다면 키만으로 결과를 조회하지 말고 세션·브라우저 상태를 확인한 뒤 필요한 경우 SMS/PIN 흐름을 다시 시작한다. PIN이나 SMS 코드를 재시도용으로 영구 저장하지 않는다.
5. 로그아웃과 브라우저 등록 해제의 응답이 유실되면 같은 요청을 다시 보낼 수 있다. 최종 상태는 `/session`과 `/browser-registration`으로 확인한다.

## 현재 연결 경계

`VITE_AUTH_MODE=http`는 가입·로그인·PIN 재설정·세션·로그아웃에만 적용한다. 물품 조회는 기존 Mock이며, 서버 계정으로 Mock 대여 코드/대여 이력을 조회하지 않도록 해당 기능은 연동 준비 중으로 처리한다. 전화번호 변경은 HTTP 모드에서 제공하지 않는다.

### 개발 실행

백엔드는 PostgreSQL과 `TAGBACK_DB_PASSWORD`를 준비하고 `sms-mock` 프로필로 실행한다. 프론트는 별도 PowerShell에서 다음 환경 변수를 설정한 뒤 실행한다. 인증 쿠키의 `Secure` 조건을 위해 신뢰할 수 있는 로컬 HTTPS 인증서를 사용한다.

```powershell
$env:VITE_AUTH_MODE='http'
$env:TAGBACK_API_TARGET='http://localhost:8080'
$env:TAGBACK_HTTPS_CERT='C:\certs\localhost.pem'
$env:TAGBACK_HTTPS_KEY='C:\certs\localhost-key.pem'
npm run dev -- --host localhost
```

브라우저는 `https://localhost:5173`으로 접속한다. 서버의 `tagback.auth.allowed-origins`에도 이 정확한 Origin을 허용한다. Vite 프록시는 Origin을 유지하며 `/api`를 지정한 서버로 전달한다. 인증서·개인키·DB 비밀번호는 저장소에 커밋하지 않는다. 환경 변수 미설정 시 기존 Mock 인증으로 실행된다.

### 구현 및 검증 범위

- PIN·SMS 코드·인증 토큰과 재시도 본문은 메모리에서만 보관한다. 세션/브라우저 인증은 HttpOnly 쿠키를 사용한다. sessionStorage에는 복구용 작업 ID와 화면 종류만 저장한다.
- 응답 유실 시 같은 키/본문을 재전송한다. 명확한 입력 오류 후 수정한 요청에는 새 키를 사용한다. 새로고침으로 본문이 사라지면 `/session`을 확인하며, 세션 부재만으로 가입 실패를 단정하지 않는다.
- SMS 확인 응답이 유실되면 확인 버튼을 막고 재발송 후 새 인증을 진행한다. 세션 조회는 30초 간격이고, 활동 연장은 로그인된 상태의 실제 입력에 한해 최대 분당 한 번 호출한다.
- `npm test`: HTTP 어댑터 계약, 응답 유실, 오류 및 기존 Mock 단위 테스트. `npm run test:http`: HTTP 응답 대체 기반 가입·두 로그인 방식·새로고침·로그아웃·재시도·중복 제출 브라우저 테스트.
- 이 작업에서는 실제 Spring 서버/PostgreSQL과의 통합 실행은 검증하지 않았다. 배포/통합 환경에서 HTTPS 쿠키 발급·재발급, Origin 허용, DB 저장, SMS 공급자 연결을 추가 검증해야 한다. HTTP 테스트의 응답 대체는 실제 쿠키 보안 동작을 보증하지 않는다.

연결 가능한 서버 흐름은 가입 SMS 확인, PIN 복구 SMS 확인·재설정, 전화번호+PIN 및 등록 브라우저 로그인, 프로필을 포함한 가입, 세션·브라우저 상태와 로그아웃이다. 전화번호 변경과 운영 SMS 발송은 아직 서버 계약/구현이 없다. HTTP 어댑터는 쿠키 기반 세션과 서버 오류 코드를 사용한다.
