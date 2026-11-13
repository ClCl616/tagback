# 키오스크 공통 빌드·호스트 연결 계약 P1

기준일: 2026-11-13. 현재 구현 범위는 설치 앱용 UI 산출물과 웹/호스트 전송 경계다. Electron main/preload, Kotlin bridge, 실제 리더기 adapter, 영구 복구 저장소와 장치별 서버 인증은 후속 구현이다.

## 빌드와 실행

`frontend`에서 실행한다.

```powershell
pnpm build                # 기존 사용자/관리자/웹 키오스크: dist/
pnpm build:kiosk          # 설치 앱 전용 공통 UI: dist-kiosk/
pnpm preview:kiosk --port 5179
pnpm test:kiosk-host      # build:kiosk 후 산출물에 가상 호스트를 주입해 검사
```

설치 진입 파일은 `dist-kiosk/kiosk-app.html`이다. 기존 웹 주소 `/kiosk`와 Vite의 확장자 없는 HTML 탐색이 충돌하지 않도록 `kiosk.html`을 사용하지 않는다. Windows/Android는 dist-kiosk 전체를 같은 구조로 동봉한다. HTML의 상대 assets 경로를 보존하고 호스트가 올바른 MIME type으로 제공해야 한다. 일반 브라우저에서 이 파일을 열면 호스트 없음 오류가 표시되는 것이 정상이다. 설치 호스트 없이 시험 데이터를 보여주거나 웹 API로 전환하지 않는다. 이 HTML은 빌드/preview로 확인하며 일반 Vite HMR 페이지로 사용하지 않는다.

`kiosk-build.json`에는 artifact, appVersion, hostProtocolVersion=2, transportVersion=1, entry, uiBuildHash, files(path/sha256)가 들어간다. files는 HTML과 JS/CSS를 포함하고 path 순으로 정렬한다. uiBuildHash는 `JSON.stringify(files)`의 SHA-256이다. manifest 자체는 files에서 제외한다. 이 hash는 산출물 동일성 확인용이며 코드 서명이나 배포자 인증을 대체하지 않는다.

`vite.kiosk.config.ts`는 사용자/관리자 모듈과 일반 인증/API 집합 모듈이 설치 빌드 그래프에 들어오면 실패시킨다. 공유 스타일은 재사용하되 외부 웹 폰트 import는 `web-fonts.css`로 분리해 기존 웹 진입점에만 적용했다. 설치 앱은 시스템 폰트를 사용하고 외부 폰트 연결에 의존하지 않는다. 전용 HTML의 CSP는 renderer의 직접 네트워크 연결을 막는다. 네이티브 호스트의 API 통신·인증서 검증은 별도 책임이다.

## 파일별 책임

| 파일 | 책임 |
|---|---|
| `src/kiosk-main.tsx` | 설치 전용 시작, host 필수 선언, 키오스크만 렌더링 |
| `src/kiosk/KioskEntry.tsx` | 호스트가 없거나 호환되지 않을 때 처리 시작 차단 |
| `src/kiosk-host/contracts.ts` | v1/v2 호스트, 명령·응답 TypeScript 계약 |
| `src/kiosk-host/runtime.ts` | 시작 시 한 번 연결 경로 선택; 실행 중 downgrade 금지 |
| `src/kiosk-host/transport.ts` | 명령을 웹 fetch 또는 host.request로 전송 |
| `src/shared/kioskHttp.ts` | 공통 응답 필드·오류·서버 연결 상태 검사 |
| `src/shared/kioskApi.ts` | 키오스크 업무 API만 모아 사용자 인증 모듈 의존 제거 |
| `src/kiosk/platform.ts` | 기존 platform import 및 v1 타입 호환 re-export |

웹 `/kiosk`는 호스트 없음→기존 Windows SSE/웹 HTTP, v1→기존 reader·웹 HTTP, v2→reader·호스트 통신을 사용한다. Android 브라우저에 호스트가 없으면 기존대로 리더기 연결 안 됨이다. 알려지지 않은 버전이나 잘못된 호스트 객체는 웹에서도 차단한다. 설치 진입점은 반드시 v2를 요구한다. 오류·타임아웃이 발생해도 호스트 경로에서 웹 HTTP로 전환하지 않는다.

## 주입 시점과 호환성

호스트는 `kiosk-main.tsx` 실행 전에 `window.tagbackKioskHost`를 제공해야 한다. UI가 선택한 연결은 실행 중 고정된다. 늦게 주입해 화면 오류가 난 상태에서는 정상적인 앱 재시작으로 초기화한다. 웹 조회가 먼저 실행된 후 설치 모드로 바꾸는 것은 허용하지 않는다.

필수 v2 형태:

```ts
{
  version: 2,
  platform: 'windows' | 'android',
  capabilities: { transport: 1 },
  reader: { subscribe(listener, { onStatus, onRemoved }): () => void },
  request(envelope): Promise<response>,
  // 선택 사항: subscribeBack, openOperatorPanel, requestExit
}
```

reader 계약은 기존 NfcAdapter와 같다. v2는 transport 규격만 표시한다. `capabilities.transport=1`은 영구 복구·ADMIN 운영·실제 NFC 연동이 검증됐다는 의미가 아니다. host v1은 기존 웹 시험 환경에서만 호환한다. 누락/미지원 version, platform, reader, optional method 타입, transport capability, request 함수는 초기화 단계에서 차단한다.

## 요청·응답 envelope

```ts
request = { version: 2, requestId: '<새 UUID>', command: { action: '...', ... } }
response = { version: 2, requestId: '<동일 UUID>', status: 200, data: { ... } }
```

requestId는 IPC 왕복 상관관계용이며 매번 새 값이다. operationId는 업무 쓰기 식별자로 같은 작업 재시도에서 유지한다. 호스트는 이 둘을 혼동하지 않는다. UI는 response version/requestId/HTTP status(정수 200~599)를 확인한다. data는 아래 기존 서버 응답 검사도 통과해야 한다. IPC 오류를 임의의 성공 status로 바꾸지 않는다.

| action | 요청 필드 | host가 수행할 기존 서버 작업 |
|---|---|---|
| health | 없음 | GET `/api/v1/kiosk/health` |
| verify | code | POST `/api/v1/kiosk/rental-grants` |
| catalog | grantRef | GET `/api/v1/item-types` |
| scan | uid, grantRef | GET `/api/tags/{uid}` |
| rent | operationId, grantRef, itemId, itemTypeId | POST `/api/v1/rentals`, 기존 Idempotency-Key=operationId |
| return-scan | proof | POST `/api/v1/rentals/return/scan` |
| return | operationId, scanTicketId, proof, condition, returnCode | POST `/api/v1/rentals/return`, 기존 ticket/proof replay |

renderer는 URL·Cookie·Authorization·임의 HTTP 헤더를 지정하지 않는다. 실제 host 구현에서는 **네이티브 경계에서도** action/필드/크기/호출 origin·frame을 검사하고 위 allowlist로만 요청해야 한다. TypeScript union과 renderer의 검사를 보안 경계로 간주하지 않는다. 개발용 가상 host 구현은 tests 안에만 있으며 제품 번들에 포함되지 않는다.

health 외 data는 기존 서버 JSON 형태를 기본으로 한다. 단 verify 성공은 아래 형태로 치환한다.

```json
{
  "grantHandle": "opaque-host-owned-reference",
  "maskedPhoneNumber": "010****5678",
  "expiresAt": "2026-11-13T03:03:00Z"
}
```

실제 bearer token은 host가 보관하고 grantHandle로 찾아 사용한다. UI 모델 호환을 위해 현재 `Grant.token` 필드에 이 handle이 들어가지만 호스트 경로에서는 HTTP Authorization에 사용하지 않는다. host는 세션/만료/완료 시 보관한 grant를 정리해야 한다. 웹 adapter의 Grant.token은 기존 실제 bearer token이다. 경로 선택을 고정해 handle이 웹 HTTP로 유출되지 않도록 한다.

P1에서는 기존 reader event/proof와 반납 코드가 UI 메모리를 거친다. NFC 비밀 서명 키는 UI에 주입하지 않는다. proof/티켓까지 불투명 handle로 전환하고 native 세션 정리·저널 저장을 소유하게 하는 작업은 P4에서 계약 버전을 구분해 확장한다. 현재 모든 인증 문맥이 native에만 존재한다고 표현하지 않는다.

return의 operationId는 기존 코드의 로컬 작업 식별자를 host에 전달하는 것이다. 웹 adapter는 이를 새 HTTP 헤더나 본문 필드로 추가하지 않으며, 기존 반납 API의 ticket/proof/condition/returnCode만 전송한다. 호스트도 서버 계약을 확장하기 전에는 같은 기존 형식을 유지한다.

## 오류·재시도·권한

- health 대기 상한 3초, 나머지 15초. host Promise가 끝나지 않아도 UI가 무한 대기하지 않는다.
- 타임아웃은 전송 취소/서버 실패 판정이 아니다. 쓰기 중 IPC 거부·응답 상관관계 오류·타임아웃은 기존 UNKNOWN 경로로 들어가고 동일 operationId와 본문으로 복구한다.
- 읽기 실패는 NETWORK/TIMEOUT, 서버의 명확한 거부는 기존 코드/태그/권한 오류로 분류한다. 서버 오류 JSON과 성공 응답 검사는 웹/호스트에서 공유한다.
- UI의 미확인 요청 보존과 취소/이전/유휴 초기화 차단을 유지한다. 프로세스 종료 후 영구 복구는 아직 구현하지 않았다.
- `openOperatorPanel`과 `requestExit`는 기존 선택적 계약이며 host가 실제 서버 ADMIN 확인과 작업 상태 검사를 수행해야 한다. 이번 P1은 관리자 세션·OS 종료 구현을 제공하지 않는다.

## 검증 구분

단위 검사는 v1 웹 호환·v2 필수 조건·호스트 grant handle·잘못된 응답·IPC 타임아웃·고정 operation replay를 검사한다. 산출물 브라우저 검사는 build:kiosk로 만든 HTML/CSS/JS와 manifest hash, 호스트 없음/버전 불일치, 가상 Windows/Android 호스트의 대여·손상 반납·응답 유실 복구를 확인한다. 가상 platform='android' 검사는 Android APK/WebView/실물 시험이 아니다.

기존 웹 HTTP/브리지 회귀를 함께 수행한다. Electron exe, Android APK, 실제 서버·DB 재검증, SMS, 외장 리더기 실물 및 강제 종료 내구성 검사는 이번 P1 범위가 아니다.

## P2 Windows 구현 추가 (2026-11-13)

`kiosk/windows`에 실제 Electron main/preload와 시험 패키징을 추가했다. [Windows README](../kiosk/windows/README.md)의 명령·프로필 설정·암호화 키 주입을 따른다. UI에는 version=2/platform=windows/capabilities.transport=1과 request/reader만 노출한다. ADMIN 운영 패널/종료 메서드는 아직 노출하지 않는다.

main은 요청 shape·고정 API·IPC main frame을 검증하고 실제 grant를 보관한다. UNKNOWN 잠금·동일 요청 replay 보호는 실행 중 메모리만 사용한다. HTTP 5xx/타임아웃/잘못된 영수증 이후 단순 인증 만료를 저장 실패로 바꾸지 않는다. 이 Windows 구현은 영구 operation manager·프로세스 재시작 복구·서버 장치 등록 완료를 의미하지 않는다.
