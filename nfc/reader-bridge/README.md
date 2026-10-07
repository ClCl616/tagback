# NFC 리더기 브리지 (7주차 뼈대)

Java 21·Gradle 프로그램이다. PC/SC(`javax.smartcardio`)에서 이름에 `ACR1552U`가 포함된 리더기를 찾고 `FF CA 00 00 00` APDU로 UID를 읽는다. 연결·제거 상태를 로컬 SSE로 전달한다. **실물 리더기 검증과 FE 연결은 아직 하지 않았다.**

PowerShell에서 이 폴더로 이동한 뒤 저장소의 기존 Gradle wrapper를 사용한다.

```powershell
cd nfc/reader-bridge
..\..\backend\gradlew.bat test
..\..\backend\gradlew.bat run --args="--port=8765 --origin=http://localhost:5173"
..\..\backend\gradlew.bat run --args="--mock-uid=04C8AB82492490 --mock-hold-ms=2000 --mock-gap-ms=1000"
```

`GET http://127.0.0.1:8765/events`는 `text/event-stream`을 반환한다. 예: `curl.exe -N -H "Origin: http://localhost:5173" http://127.0.0.1:8765/events`. 서버는 IPv4 loopback에만 바인딩하며 브라우저 Origin은 지정한 값 하나만 허용한다. 기본값은 포트 `8765`, Origin `http://localhost:5173`, 폴링 `250ms`다. `--port`, `--origin`, `--reader`, `--mock-uid`, `--poll-ms`, `--mock-hold-ms`, `--mock-gap-ms`를 쓸 수 있고, 각각 `NFC_BRIDGE_PORT`, `NFC_BRIDGE_ORIGIN`, `NFC_BRIDGE_READER`, `NFC_BRIDGE_MOCK_UID`, `NFC_BRIDGE_POLL_MS`, `NFC_BRIDGE_MOCK_HOLD_MS`, `NFC_BRIDGE_MOCK_GAP_MS` 환경변수도 지원한다. 실행 옵션이 환경변수보다 우선한다.

SSE의 `event` 이름과 JSON `type`은 `TAG_READ`, `TAG_REMOVED`, `READER_CONNECTED`, `READER_DISCONNECTED` 중 하나다. `TAG_READ`에만 정규화된 `uid`가 있다. UID 규칙은 백엔드처럼 공백·콜론·하이픈 제거, 대문자 16진수 8/14/20자리다. 같은 태그가 계속 보이면 추가 `TAG_READ`를 보내지 않고, 실제 부재가 관찰되면 `TAG_REMOVED`를 보낸다. 리더기가 사라지면 `READER_DISCONNECTED`를 보내고 다음 폴링에서 다시 탐색한다. 모의 모드는 지정된 시간 동안 태그가 놓인 상태와 제거된 상태를 반복한다.

이 이벤트 형식은 v1 **제안**이다. CORS는 브라우저 접근 제한일 뿐 로컬 HTTP 인증이 아니므로, 배포 전에 FE Origin, 접근 제어, 이벤트 계약을 확정해야 한다.
