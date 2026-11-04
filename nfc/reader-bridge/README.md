# NFC 리더기 브리지

Java 21·Gradle 프로그램이다. PC/SC(`javax.smartcardio`)에서 이름에 `ACR1552U`가 포함된 리더기를 찾고 `FF CA 00 00 00` APDU로 UID를 읽는다. 연결·제거 상태를 로컬 SSE로 전달한다. 실제 태그 이벤트에는 서버가 검증할 HMAC-SHA256 스캔 증명이 포함된다.

PowerShell에서 이 폴더로 이동한 뒤 백엔드와 브리지에 같은 32바이트 이상의 임의 비밀값을 설정한다. 값을 저장소에 커밋하지 않는다.

```powershell
cd nfc/reader-bridge
$env:NFC_SCAN_SECRET = '<백엔드와 동일한 32바이트 이상 비밀값>'
$env:NFC_BRIDGE_ID = 'kiosk-1'
..\..\backend\gradlew.bat test
..\..\backend\gradlew.bat run --args="--port=8765 --origin=http://localhost:5173"
..\..\backend\gradlew.bat run --args="--mock-uid=04C8AB82492490 --mock-hold-ms=2000 --mock-gap-ms=1000"
```

백엔드 실행 환경에도 같은 값을 `NFC_SCAN_SECRET`으로, 같은 식별자를 `NFC_BRIDGE_ID`로 설정한다. 설정이 빠지면 브리지는 시작하지 않고, 값이 서로 다르면 백엔드가 스캔 증명을 거부한다. 백엔드는 설정된 `NFC_BRIDGE_ID` 하나만 신뢰한다.

`GET http://127.0.0.1:8765/events`는 `text/event-stream`을 반환한다. 서버는 IPv4 loopback에만 바인딩하며 브라우저 Origin은 지정한 값 하나만 허용한다. 기본값은 포트 `8765`, Origin `http://localhost:5173`, 폴링 `250ms`다. `--port`, `--origin`, `--reader`, `--mock-uid`, `--poll-ms`, `--mock-hold-ms`, `--mock-gap-ms`, `--remove-after`, `--ping-ms`를 지원한다. 환경 변수 `NFC_BRIDGE_PORT`, `NFC_BRIDGE_ORIGIN`, `NFC_BRIDGE_READER`, `NFC_BRIDGE_MOCK_UID`, `NFC_BRIDGE_POLL_MS`, `NFC_BRIDGE_MOCK_HOLD_MS`, `NFC_BRIDGE_MOCK_GAP_MS`, `NFC_BRIDGE_REMOVE_AFTER`, `NFC_BRIDGE_PING_MS`도 사용할 수 있다. 실행 옵션이 환경변수보다 우선한다. `NFC_SCAN_SECRET`과 `NFC_BRIDGE_ID`는 환경 변수로 전달한다.

SSE 이벤트는 `TAG_READ`, `TAG_REMOVED`, `READER_CONNECTED`, `READER_DISCONNECTED`다. 실제 리더기의 `TAG_READ`에는 정규화된 `bridgeId`, `uid`, `issuedAt`, UUID `nonce`, HMAC 서명 `signature`가 포함된다. 서명은 `bridgeId + newline + uid + newline + issuedAt + newline + nonce`를 공유 비밀값으로 HMAC-SHA256 처리한다. 서버는 설정된 브리지 ID와 발급 후 60초 이내의 서명을 확인하고, 반납 스캔 교환 단계에서 nonce를 소비해 증명 재전송을 막는다. 태그와 진행 중 대여를 확인한 서버는 키오스크·태그·스캔 nonce·대여에 묶인 별도의 60초짜리 1회용 반납 티켓을 발급한다. 최종 반납 요청도 같은 서명 증명을 제시해야 하며, 서버는 티켓과 일치하는 브리지 ID·UID·nonce인지 확인한 뒤 티켓을 소비한다. `--mock-uid` 모드는 서명을 만들지 않으므로 반납 검증을 통과하지 않는다.

같은 태그가 계속 보이면 추가 `TAG_READ`를 보내지 않고, 실제 부재가 관찰되면 `TAG_REMOVED`를 보낸다. 태그 제거는 기본적으로 연속 2번 비었을 때 발생하고, SSE는 기본 15초마다 `: ping` 주석을 보낸다. 리더기가 사라지면 `READER_DISCONNECTED`를 보내고 다음 폴링에서 다시 탐색한다.

브리지 바이너리와 환경 비밀은 신뢰된 키오스크 장비에만 배포한다. CORS는 브라우저 접근 제한일 뿐 인증 수단이 아니다.
