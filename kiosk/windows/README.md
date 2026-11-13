# Windows 키오스크 시험 호스트 (P2)

2026-11-13. 공통 `frontend/dist-kiosk`를 Electron에 동봉하는 Windows x64 시험 앱이다. 현재 운영 배포용이 아니다. 서버·리더기 설정 없이 실행하면 연결 끊김 안내와 이용 시작 차단이 정상이다.

## 빌드와 실행

빌드 PC: Windows x64, Node 24, npm, pnpm, JDK 21 (`java`, `jlink` PATH), 기존 Gradle 의존성 캐시. 실행 PC에는 Node/Java 별도 설치가 필요 없다. 최초 Gradle 의존성이 없으면 `nfc/reader-bridge`에서 `../../backend/gradlew.bat test`로 먼저 받는다.

```powershell
cd C:/Projects/tagback-user-web/kiosk/windows
npm ci
npm test
npm run make
npm run test:smoke
```

`make`는 공통 UI 빌드 → Java jar → jlink Java 21 런타임 → Forge/Squirrel 순서다. `resources/`는 스크립트가 재생성하는 빌드 전용 폴더다. 설정이나 키를 넣지 않는다. Electron 45.3.1 / Forge 8.0.1을 lockfile로 고정했다. Windows main/preload는 별도 변환 단계가 필요 없는 CommonJS로 작성했고 UI의 TypeScript host v2 계약을 따른다.

산출물:

- `out/TagBackKiosk-win32-x64/TagBackKiosk.exe`: 직접 실행. **같은 폴더 전체**를 함께 옮겨야 한다.
- `out/make/squirrel.windows/x64/TagBackKiosk-0.1.0-trial-Setup.exe`: 서명하지 않은 시험 설치 파일. 아직 설치/제거 검증을 수행하지 않았다.
- 같은 설치 폴더의 `RELEASES`, `*-full.nupkg`: 함께 보관. 자동 업데이트는 연결하지 않았다.
- `resources/package-manifest.json`: 앱/UI hash/Java 버전. SHA-256은 파일 일관성 검사이며 배포자 서명을 대체하지 않는다.
- `out/smoke/windows-kiosk.png`, `result.json`: 실제 패키지 실행 검사 기록.

개발 실행은 `npm run prepare:resources` 후 `npm start`. `start`는 Electron 개발 실행 바이너리를 내려받을 수 있다. 설치된 앱은 저장소나 Vite 서버를 사용하지 않는다.

## 로컬 시험 설정

기본 프로필은 `%APPDATA%/tagback-kiosk`. 시험에서는 `TagBackKiosk.exe --kiosk-profile=C:\TagBackTrial`처럼 **별도 전용 폴더**를 지정할 수 있다. 모든 설정과 암호화 키는 동일 프로필·동일 Windows 사용자 계정을 사용한다. 설정 변경 시 앱을 종료하고 다시 실행한다. 프로필 경로는 OS 실행 옵션이며 renderer에서 변경할 수 없다.

`host-config.json` 예시 (실제 서버 값으로 교체):

```json
{
  "apiBaseUrl": "https://api.example.com",
  "bridgeId": "station-trial-01",
  "readerName": "ACR1552U"
}
```

HTTPS origin만 허용한다. 경로·사용자 정보·query·fragment, HTTP, TLS 인증서 예외, renderer 지정 URL을 허용하지 않는다. 서버의 실제 bridgeId와 서명 키가 일치해야 한다. `readerName`은 기존 PC/SC 코드의 장치명 부분 일치 필터다. 리더기 모델 지원은 사용자 전제로 두었으며 실물 동작은 아직 검증하지 않았다.

키는 JSON이나 명령 인자에 넣지 않는다. 앱을 닫고 PowerShell 7에서 아래 도우미의 비표시 입력으로 전달한다. 도우미는 임의 이름의 CurrentUserOnly 전용 named pipe로 보내고 Windows 계정에 연결된 Electron safeStorage 암호문 `reader-secret.bin`을 생성한다. 장치 등록/ADMIN 검증 API를 대신하는 기능은 아니다. 프로필 접근은 해당 Windows 운영 계정으로 제한해야 한다. 초기 GUI exe stdin 입력 방식은 smoke에서 완료되지 않아 사용하지 않는다. NFC Java 자식 프로세스의 stdin/stdout은 별개이며 정상 검증했다.

```powershell
./scripts/provision-secret.ps1 `
  -Executable ./out/TagBackKiosk-win32-x64/TagBackKiosk.exe `
  -ProfileDirectory C:/TagBackTrial
```

## 구현 범위

- `tagback://app/kiosk-app.html` 전용 로컬 protocol, manifest 파일 allowlist/hash 검사, CSP 유지. 파일 시스템을 임의로 읽는 protocol이 아니다.
- sandbox/contextIsolation 사용, Node 미노출, 메인 프레임·주소 IPC 검증. 외부 탐색·팝업·권한·다운로드·웹뷰 차단, 패키지 DevTools 비활성화.
- main이 HTTPS API·grant token을 보유하고 UI에는 임의 handle만 제공한다. 고정된 7개 명령만 허용하며 쿠키/redirect를 사용하지 않는다.
- 대여는 기존 Idempotency-Key, 반납은 기존 ticket/proof/condition/returnCode 본문을 유지한다. 반납 operationId를 서버가 지원하지 않는 새 헤더로 보내지 않는다.
- 실행 중 미확인 쓰기를 메모리에 유지하고 새 작업·정상 종료·새로고침을 차단한다. 동일 작업 중복 호출은 한 요청을 공유하고, 응답 유실 후 동일 요청으로만 재시도한다. 성공 영수증 검증 후 완료 응답을 전달한다.
- 단일 인스턴스. Java PC/SC 자식 프로세스와 비공개 stdin/stdout 통신, 키를 argv/env에 전달하지 않음, 종료 시 정리, 실패 시 최대 30초 간격 재시작. 기존 개발용 SSE 브리지는 유지한다.
- private reader 입력: `TAGBACK_READER_V1` + base64(bridgeId), base64(readerName), base64(secret), 각 LF로 종료. stdout은 기존 BridgeEvent JSON 한 줄. 추가 명령은 없고 stdin EOF로 종료한다. TCP 포트를 열지 않는다.

## 검증과 남은 작업

호스트 단위 8개, Java 17개 통과. 실제 패키지 실행에서 로컬 UI·v2 주입·격리 옵션·DevTools 차단·임의 명령/브라우저 네트워크 거부·미설정 연결 차단을 확인했다. 동봉 Java에서 리더기 없음 이벤트와 부모 EOF 종료를 확인했다. 화면 캡처도 확인했다. 최초 smoke의 `getLastWebPreferences().devTools` 조회는 Electron에서 값이 반환되지 않아 실패했고, 실제 DevTools 열기 거부를 검사하도록 수정했다.

API 단위 검사는 주입한 응답 fixture다. 이번 P2에서 실제 서버/DB·SMS·물리 NFC·다른 PC·설치/제거/업그레이드를 검증하지 않았다. P2의 타 PC 설치 인수 조건은 남아 있다.

현재 보호 상태는 **메모리 전용**이다. 프로세스 강제 종료·전원 장애 후 미확인 거래를 복구하지 못한다. 그런 경우 새 거래 전에 서버 기록을 관리자가 확인해야 한다. 자동 종료/자동 재시작/자동 업데이트/OS 키오스크 잠금을 켜지 않는다. ADMIN 운영 패널·종료 API도 노출하지 않는다. P4 영구 journal·서버 장치/operation 계약, P5 관리자·서명·운영, P6 실물 인수가 필요하다. Android APK는 별도 P3 작업이다.

참조: [패키징 설계](../../docs/kiosk-packaging-design.md), [공통 계약](../../docs/kiosk-host-contract.md), [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol), [Forge Squirrel.Windows](https://www.electronforge.io/config/makers/squirrel.windows).

## 0.1.1 전체화면과 단축키 (2026-11-13)

앱을 실행하면 전체화면으로 시작한다. 단축키는 앱이 선택된 동안만 작동한다.

| 단축키 | 기능 |
|---|---|
| F11 | 전체화면 / 창 모드 전환 |
| Ctrl+Shift+Q | 종료 확인 (기본 선택은 계속 사용) |
| Ctrl+Shift+M | 최소화 |
| F1 | 단축키 안내 |
| Alt+F4 | 창 닫기 |

미확인 대여·반납이 있으면 종료 요청과 창 닫기를 차단한다. 최소화·창 모드 전환은 거래 상태를 초기화하지 않는다. F5/Ctrl+R 새로고침 차단을 유지한다. 이 단축키는 로컬 시험 앱 조작 기능이며 ADMIN 인증 운영 패널이나 OS 접근 제한을 대체하지 않는다.

설치 앱 전용 CSS에서 화면 높이에 맞춰 여백·이미지·확인 정보 배치를 조정하고 상단/하단 조작부를 고정했다. 긴 물품 목록·오류 안내·아주 작은 창에서는 내용 영역만 스크롤되며, 정보를 잘라내거나 터치 버튼을 과도하게 축소하지 않는다. 사용자/관리자 웹 CSS 동작은 바꾸지 않는다.

새 설치 파일은 `out/make/squirrel.windows/x64/TagBackKiosk-0.1.1-trial-Setup.exe`다. 실행 중인 0.1.0 앱을 정상 종료하고 새 설치 파일을 실행한다. 이번 수정본의 자동 설치/업그레이드는 에이전트가 수행하지 않는다. 이전 버전 설치와 화면 표시는 사용자가 직접 확인했다고 보고했다.

0.1.1 최종 package/make 및 실제 exe smoke 재통과. 패키지 native 소스와 최종 UI hash 일치를 확인했고 전체화면 캡처를 검토했다. SHA256SUMS.txt를 설치 산출물 폴더에 생성했다. UI 검사 10개·호스트 단위 8개 통과. 이번 수정본 설치/업그레이드는 사용자가 진행하며 에이전트가 실행하지 않았다.

## 0.1.2 실제 서버 통합 수정 (2026-11-13)

실제 서버 health API는 본문 없는 200을 반환한다. 이전 native transport가 JSON 파싱에 실패해 정상 서버를 끊김으로 표시하던 오류를 수정했다. health만 빈 본문을 허용하며 업무 API의 JSON/영수증 검증은 유지한다. 호스트 단위 9개, 실제 exe smoke와 사용자 웹→Windows→관리자 실연동 검사 통과. SMS/NFC 경계는 시험용 대체이며 실제 API/DB는 사용했다.

새 설치 파일: `out/make/squirrel.windows/x64/TagBackKiosk-0.1.2-trial-Setup.exe`. 실행 중인 앱을 정상 종료하고 설치한다. 설치/업그레이드는 아직 에이전트가 수행하지 않았다. 결과 및 재현: [통합 검증 보고서](../../docs/integration-validation-2026-11-13.md). Android는 보류한다.
