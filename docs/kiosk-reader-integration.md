# 7주차 키오스크–리더기–대여 API 수동 점검

기본값은 기존 브라우저 모의 모드다. `VITE_KIOSK_MODE=bridge`를 설정한 키오스크만 로컬 SSE와 실제 백엔드 API를 사용한다. 이 모드에서 순서는 **코드 검증 → 물품 종류 선택 → 태그 인식 → 대여 확정**이다. 종류 목록과 태그 조회에 코드 검증으로 발급된 반출 토큰이 필요하기 때문이다. 모바일 대여 코드 *발급* UI는 이번 연동에서 제외했다. 실제 반납 API도 아직 없으므로 브리지 모드의 반납 버튼은 비활성화된다.

## 준비

- PostgreSQL 전용 개발 DB를 준비하고 백엔드 폴더에서 `.\gradlew.bat bootRun --args="--spring.profiles.active=sms-mock"`으로 실행한다. 대여 코드 API는 이 프로필에서만 존재하며 `prod`/`production`에는 없다. DB 주소는 `SPRING_DATASOURCE_URL`, 비밀번호는 `TAGBACK_DB_PASSWORD` 환경변수로 전달한다. 이미 사용 중인 DB나 운영 DB에는 테스트 데이터를 넣지 않는다.
- 브리지 폴더 `nfc/reader-bridge`에서 Java 21로 `..\..\backend\gradlew.bat run --args="--port=8765 --origin=http://127.0.0.1:5173"`을 실행한다. 실물 리더기를 쓰지 않는 시연에는 `--mock-uid=04C8AB82492490 --mock-hold-ms=2000 --mock-gap-ms=1000`을 인자에 추가한다. 실물 UID를 쓸 때는 `--mock-uid`를 빼고 실제 태그의 UID를 DB에 등록한다. 장비 검증은 별도로 해야 한다.
- `frontend` 폴더에서 PowerShell로 `$env:VITE_KIOSK_MODE='bridge'`, `$env:TAGBACK_API_TARGET='http://127.0.0.1:8080'`을 설정한 뒤 `pnpm dev`를 실행한다. 키오스크는 `http://127.0.0.1:5173/kiosk`를 연다. 프록시는 `/api`를 백엔드로 전달한다. 브리지의 `--origin`은 이 주소와 정확히 같아야 한다. 포트를 바꾸려면 현재 고정된 `frontend/src/shared/nfc.ts`의 SSE 주소도 변경해야 한다.
- 프론트에서 모바일 로그인을 시연할 때는 기존 모바일 모의 인증과 서버 인증을 혼동하지 않는다. 수동 코드 발급에는 **백엔드가 발급한** 로그인 세션 쿠키가 필요하다. 테스트 계정이나 쿠키·토큰을 문서·커밋·공개 로그에 남기지 않는다.

## 테스트 데이터와 코드 발급

전용 개발 DB에 물품 종류가 없다면 관리자 승인 후 `INSERT INTO item_types (name, description) VALUES ('7주차 테스트 우산', '개발 전용') RETURNING item_type_id;`로 종류 ID를 얻는다. 백엔드 관리자 세션으로 `POST /api/v1/items`에 `{ "itemName":"7주차 테스트 우산 1", "itemTypeId":"<위에서 반환한 숫자 문자열>" }`을 보내 물품 ID를 얻는다. 이어서 `POST /api/items/{itemId}/tag`에 `{ "uid":"<실물 또는 모의 리더기의 UID>" }`를 보낸다. 태그가 연결되면 물품이 `TAG_PENDING`이었다면 `AVAILABLE`로 전환된다. 두 관리자 API는 일반 사용자 세션이나 반출 토큰으로 호출할 수 없다. 이미 존재하는 물품·태그를 사용할 수도 있다. 이 절차는 테스트 전용 DB에서만 수행한다.

### 계정 만들기와 역할

저장소에서 확인한 범위에는 자동 시드 계정, 관리자 계정용 환경변수, 가입 시 역할을 지정하는 API가 없다. `SignupService`가 새 가입자를 만들고 `User`의 기본 역할은 `USER`다. 따라서 일반 테스트 계정은 `sms-mock`에서 가입 API로 만들고, 관리자 테스트 계정은 같은 방법으로 만든 뒤 **폐기 가능한 개발 DB에서만** DB 관리 권한으로 역할을 `ADMIN`으로 바꾼다. 기존 계정의 역할을 바꾸기 전에는 반드시 테스트 DB와 대상 계정 ID를 확인한다.

직전 임시 스택에서 실제로 실행한 계정 준비 명령은 저장소에 기록되어 있지 않아 그대로 재현했는지는 확인할 수 없다. 아래는 현재 코드에서 확인되는 절차다.

아래 PowerShell 예시는 `sms-mock` 전용 SMS 요청 → 모의 문자 확인 → 인증 증명 발급 → 가입 흐름이다. 전화번호와 PIN은 실행할 때 입력하고, 응답의 인증 코드와 인증 증명은 변수에만 둔다. 가입 계정은 기본적으로 `USER`다.

```powershell
$backendBase = 'http://127.0.0.1:8080' # 실제 백엔드 주소로 바꾼다. Origin에도 같은 origin을 쓴다.
$phone = Read-Host '테스트 계정 전화번호'
$requestHeaders = @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$smsRequest = Invoke-RestMethod -Method Post -Uri "$backendBase/api/v1/auth/sms/requests" `
  -Headers $requestHeaders -ContentType 'application/json' `
  -Body (@{ phoneNumber = $phone; purpose = 'SIGNUP' } | ConvertTo-Json)

# sms-mock이 전달한 일회용 코드는 이 개발 전용 조회 API에서 확인한다.
$mockMessage = Invoke-RestMethod -Method Get `
  -Uri "$backendBase/api/v1/dev/sms/requests/$($smsRequest.requestId)"
$verification = Invoke-RestMethod -Method Post `
  -Uri "$backendBase/api/v1/auth/sms/verifications" -ContentType 'application/json' `
  -Body (@{ requestId = $smsRequest.requestId; code = $mockMessage.code } | ConvertTo-Json)

$pinSecure = Read-Host '테스트 계정 PIN (숫자 6자리)' -AsSecureString
$pin = [System.Net.NetworkCredential]::new('', $pinSecure).Password
$signupHeaders = @{
  'Idempotency-Key' = [guid]::NewGuid().ToString()
  Origin = $backendBase
}
$signup = Invoke-RestMethod -Method Post -Uri "$backendBase/api/v1/auth/signup" `
  -Headers $signupHeaders -ContentType 'application/json' `
  -Body (@{
    verificationToken = $verification.verificationToken
    pin = $pin
    profile = @{ name = '개발 테스트'; occupation = '학생' }
  } | ConvertTo-Json -Depth 4)
$userId = $signup.user.userId
```

`POST /api/v1/auth/sms/requests`는 `phoneNumber`, `purpose`를 받고 `requestId`를 돌려준다. `GET /api/v1/dev/sms/requests/{requestId}` 응답의 `code`가 `sms-mock` 인증 코드다. 이 조회 API는 개발 프로필 전용이므로 실제 운영 문자 발송 절차와 혼동하지 않는다. `POST /api/v1/auth/sms/verifications` 본문은 `requestId`, `code`이며, 응답의 `verificationToken`을 가입에 쓴다. 가입 요청은 `POST /api/v1/auth/signup`이고 본문은 `verificationToken`, 6자리 `pin`, `profile`의 `name`·`occupation`이다. 가입과 로그인 요청에는 각각 새 UUID `Idempotency-Key`를 넣는다.

관리자 테스트 계정은 가입 후 `$userId`를 확인하고, 테스트 DB에 직접 연결해 다음과 같이 역할을 바꾼다. 이 저장소에는 이 역할 부여를 대신하는 시드·환경변수·관리자 생성 API가 확인되지 않았다.

```powershell
# $dbHost, $dbPort, $dbName, $dbUser는 폐기 가능한 테스트 DB의 접속 정보다.
# psql 인증은 로컬의 안전한 방식으로 설정한다. 암호를 명령 인자에 넣지 않는다.
$sql = "UPDATE users SET role = 'ADMIN' WHERE user_id = $userId RETURNING user_id, role;"
psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -c $sql
```

### 관리자·모바일 로그인 세션과 코드 발급

두 계정 모두 `POST /api/v1/auth/login/phone`에 `phoneNumber`, 6자리 `pin`을 보내 로그인한다. 응답에는 `Set-Cookie`로 `__Host-tagback-session`(인증에 쓰는 세션 쿠키)과 `__Host-tagback-browser`(브라우저 등록 쿠키)가 설정된다. 관리자 계정은 역할 변경 후 다시 로그인하고 응답의 사용자 `role`이 `ADMIN`인지 확인한다. 일반 계정은 `USER`인지 확인한다.

다음 예시는 로그인 응답에서 세션 쿠키만 꺼내 코드 발급 요청에 전달한다. 쿠키의 실제 값은 화면에 출력하지 않는다. 쿠키는 `Secure` 속성으로 발급되므로 브라우저가 자동 관리하는 환경은 HTTPS를 사용한다. 아래처럼 loopback 개발 주소에서 헤더를 직접 전달하는 방식은 로컬 테스트 전용이며, 원격·공용 네트워크에서 사용하지 않는다. `Origin`은 `AuthOriginGuard` 검사를 위해 백엔드와 같은 origin으로 설정한다.

```powershell
$loginHeaders = @{
  'Idempotency-Key' = [guid]::NewGuid().ToString()
  Origin = $backendBase
}
$loginResponse = Invoke-WebRequest -Method Post `
  -Uri "$backendBase/api/v1/auth/login/phone" -Headers $loginHeaders `
  -ContentType 'application/json' `
  -Body (@{ phoneNumber = $phone; pin = $pin } | ConvertTo-Json) `
  -ResponseHeadersVariable responseHeaders
$loginBody = $loginResponse.Content | ConvertFrom-Json
# 관리자 시연은 ADMIN, 모바일 일반 계정은 USER인지 확인한다.
$expectedRole = 'USER' # 관리자 로그인 검증 시에는 'ADMIN'으로 설정
if ($loginBody.user.role -ne $expectedRole) { throw '계정 역할이 기대한 값과 다릅니다.' }

$setCookies = @($responseHeaders['Set-Cookie'])
$sessionSetCookie = $setCookies | Where-Object { $_ -match '^__Host-tagback-session=' } | Select-Object -First 1
if (-not $sessionSetCookie) { throw '로그인 응답에서 세션 쿠키를 찾지 못했습니다.' }
$sessionCookie = ($sessionSetCookie -split ';', 2)[0]

$rentalCode = Invoke-RestMethod -Method Post -Uri "$backendBase/api/v1/rental-codes" `
  -Headers @{ Cookie = $sessionCookie; Origin = $backendBase } `
  -ContentType 'application/json' -Body '{}'
# 코드 값은 로컬 PowerShell 변수에만 보관한다. 기록·공유·로그 출력하지 않는다.
$rentalCodeValue = $rentalCode.code
```

모바일 앱에서 로그인할 일반 계정도 동일한 `/api/v1/auth/login/phone` 절차를 쓴다. 이미 가입된 계정이면 SMS 요청 없이 전화번호와 PIN으로 로그인할 수 있다. 신규 계정은 앞의 `SIGNUP` 절차를 먼저 수행한다. 대여 코드 발급 응답의 `code`를 키오스크에 입력하면 `POST /api/v1/kiosk/rental-grants`가 반출 토큰을 발급하고, 이후 종류 목록·태그 조회·대여 요청은 Bearer 토큰을 사용한다. 이 토큰은 키오스크 메모리에만 두고 취소·완료·시간 초과 때 버린다.

시연 후에는 PowerShell에 남은 인증 자료를 정리한다. 코드 발급 결과를 화면에 출력하지 말고, 실제 쿠키·인증 코드·토큰을 문서나 로그에 복사하지 않는다.

```powershell
Remove-Variable backendBase,phone,requestHeaders,smsRequest,mockMessage,verification,pinSecure,pin,signupHeaders,signup,userId,sql,loginHeaders,loginResponse,loginBody,expectedRole,responseHeaders,setCookies,sessionSetCookie,sessionCookie,rentalCode,rentalCodeValue -ErrorAction SilentlyContinue
```

## 확인 항목과 한계

1. 코드 검증 후 종류 목록에 **물품이 하나도 없는 종류까지** 나오는지 확인한다.
2. 해당 종류 선택 후 태그를 읽혀 물품명·대여 가능 상태가 맞는지 본다. 다른 종류, 미등록/비활성 태그, 대여 불가 물품은 안내를 보여야 한다.
3. 대여 확정 후 201 또는 동일 요청의 200 응답으로 완료 화면이 나오는지 확인한다. 네트워크 응답이 끊겨 결과가 불명확하면 **같은** `Idempotency-Key`, 토큰, 물품·종류 ID로 다시 요청한다. 재시도 중 토큰 만료·무효 응답이 오면 성공·실패를 단정할 수 없으며, 이 계약에는 만료 후 결과 조회 API가 없다. 새 코드나 새 요청 키로 다시 반출하지 말고 관리자에게 결과를 문의한다.
4. 브리지를 끊고 다시 실행할 때 연결 상태 표시가 바뀌는지 확인한다. 기존 `BroadcastChannel` 시뮬레이터는 기본 모드에서 그대로 작동한다.

브라우저·단위 테스트는 모의 SSE/HTTP 응답으로 실행했으며, 실물 ACR1552U, 태그, 실제 서버·DB 전체 흐름의 수동 검증 결과는 아직 없다. SSE 이벤트 형식은 v1 제안이며 로컬 CORS는 인증이 아니다. 브리지 모드에서 모바일 코드 발급 UI와 실서버 반납은 구현 범위 밖이다.
