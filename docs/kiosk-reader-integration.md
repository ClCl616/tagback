# 7주차 키오스크–리더기–대여 API 수동 점검

기본값은 기존 브라우저 모의 모드다. `VITE_KIOSK_MODE=bridge`를 설정한 키오스크만 로컬 SSE와 실제 백엔드 API를 사용한다. 이 모드에서 순서는 **코드 검증 → 물품 종류 선택 → 태그 인식 → 대여 확정**이다. 종류 목록과 태그 조회에 코드 검증으로 발급된 반출 토큰이 필요하기 때문이다. 모바일 대여 코드 *발급* UI는 이번 연동에서 제외했다. 실제 반납 API도 아직 없으므로 브리지 모드의 반납 버튼은 비활성화된다.

## 준비

- PostgreSQL 전용 개발 DB를 준비하고 백엔드 폴더에서 `.\gradlew.bat bootRun --args="--spring.profiles.active=sms-mock"`으로 실행한다. 대여 코드 API는 이 프로필에서만 존재하며 `prod`/`production`에는 없다. DB 주소는 `SPRING_DATASOURCE_URL`, 비밀번호는 `TAGBACK_DB_PASSWORD` 환경변수로 전달한다. 이미 사용 중인 DB나 운영 DB에는 테스트 데이터를 넣지 않는다.
- 브리지 폴더 `nfc/reader-bridge`에서 Java 21로 `..\..\backend\gradlew.bat run --args="--port=8765 --origin=http://127.0.0.1:5173"`을 실행한다. 실물 리더기를 쓰지 않는 시연에는 `--mock-uid=04C8AB82492490 --mock-hold-ms=2000 --mock-gap-ms=1000`을 인자에 추가한다. 실물 UID를 쓸 때는 `--mock-uid`를 빼고 실제 태그의 UID를 DB에 등록한다. 장비 검증은 별도로 해야 한다.
- `frontend` 폴더에서 PowerShell로 `$env:VITE_KIOSK_MODE='bridge'`, `$env:TAGBACK_API_TARGET='http://127.0.0.1:8080'`을 설정한 뒤 `pnpm dev`를 실행한다. 키오스크는 `http://127.0.0.1:5173/kiosk`를 연다. 프록시는 `/api`를 백엔드로 전달한다. 브리지의 `--origin`은 이 주소와 정확히 같아야 한다. 포트를 바꾸려면 현재 고정된 `frontend/src/shared/nfc.ts`의 SSE 주소도 변경해야 한다.
- 프론트에서 모바일 로그인을 시연할 때는 기존 모바일 모의 인증과 서버 인증을 혼동하지 않는다. 수동 코드 발급에는 **백엔드가 발급한** 로그인 세션 쿠키가 필요하다. 테스트 계정이나 쿠키·토큰을 문서·커밋·공개 로그에 남기지 않는다.

## 테스트 데이터와 코드 발급

전용 개발 DB에 물품 종류가 없다면 관리자 승인 후 `INSERT INTO item_types (name, description) VALUES ('7주차 테스트 우산', '개발 전용') RETURNING item_type_id;`로 종류 ID를 얻는다. 백엔드 관리자 세션으로 `POST /api/v1/items`에 `{ "itemName":"7주차 테스트 우산 1", "itemTypeId":"<위에서 반환한 숫자 문자열>" }`을 보내 물품 ID를 얻는다. 이어서 `POST /api/items/{itemId}/tag`에 `{ "uid":"<실물 또는 모의 리더기의 UID>" }`를 보낸다. 태그가 연결되면 물품이 `TAG_PENDING`이었다면 `AVAILABLE`로 전환된다. 두 관리자 API는 일반 사용자 세션이나 반출 토큰으로 호출할 수 없다. 이미 존재하는 물품·태그를 사용할 수도 있다. 이 절차는 테스트 전용 DB에서만 수행한다.

백엔드 모바일 로그인으로 받은 `__Host-tagback-session` 쿠키로 코드 발급 API를 직접 호출한다. 예시는 PowerShell 변수에 쿠키 값을 입력받아 사용하며 값을 파일에 저장하지 않는다. 실제 세션 쿠키를 받은 적이 없으면 이 단계는 진행할 수 없다.

```powershell
$secret = Read-Host '백엔드 로그인 세션 쿠키 값' -AsSecureString
$cookieValue = [System.Net.NetworkCredential]::new('', $secret).Password
$headers = @{ Cookie = "__Host-tagback-session=$cookieValue"; Origin = 'http://127.0.0.1:8080' }
$issued = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/v1/rental-codes' -Headers $headers -ContentType 'application/json' -Body '{}'
$issued.code
```

`Origin`은 직접 호출할 백엔드 주소와 일치해야 한다. 개발용 HTTPS/도메인 설정이 다르면 쿠키의 Secure 정책에 맞는 로그인 환경을 마련해야 한다. 시연 후 셸에 남은 변수는 `Remove-Variable cookieValue,secret,headers,issued`로 지운다. 코드를 키오스크에 입력하면 `POST /api/v1/kiosk/rental-grants`가 토큰을 발급하고, 이후 목록·조회·대여 요청은 Bearer 토큰을 사용한다. 이 토큰은 키오스크 메모리에만 두고 취소·완료·시간 초과 때 버린다.

## 확인 항목과 한계

1. 코드 검증 후 종류 목록에 **물품이 하나도 없는 종류까지** 나오는지 확인한다.
2. 해당 종류 선택 후 태그를 읽혀 물품명·대여 가능 상태가 맞는지 본다. 다른 종류, 미등록/비활성 태그, 대여 불가 물품은 안내를 보여야 한다.
3. 대여 확정 후 201 또는 동일 요청의 200 응답으로 완료 화면이 나오는지 확인한다. 네트워크 응답이 끊겨 결과가 불명확하면 같은 `Idempotency-Key`, 토큰, 물품 ID로 다시 요청한다. 토큰이 만료된 뒤에는 재조회 API가 없어 결과를 확정할 수 없으므로 모바일 대여 현황 또는 관리자를 통해 확인한다.
4. 브리지를 끊고 다시 실행할 때 연결 상태 표시가 바뀌는지 확인한다. 기존 `BroadcastChannel` 시뮬레이터는 기본 모드에서 그대로 작동한다.

브라우저·단위 테스트는 모의 SSE/HTTP 응답으로 실행했으며, 실물 ACR1552U, 태그, 실제 서버·DB 전체 흐름의 수동 검증 결과는 아직 없다. SSE 이벤트 형식은 v1 제안이며 로컬 CORS는 인증이 아니다. 브리지 모드에서 모바일 코드 발급 UI와 실서버 반납은 구현 범위 밖이다.
