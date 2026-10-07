# 자동 CI

## 실행 범위

`.github/workflows/frontend-ci.yml`은 `develop` 또는 `main`을 대상으로 PR을 만들거나 갱신할 때, 두 브랜치에 push할 때 실행됩니다. 문서만 바꾸는 PR도 실행하여 필수 검사가 대기 상태로 남지 않도록 합니다.

검사 이름은 `Frontend checks`입니다. Ubuntu에서 Node.js 24.19.0과 pnpm 11.19.0을 사용하며 lockfile을 변경하지 않고 의존성을 설치합니다.

1. TypeScript 검사 및 Vite 프로덕션 빌드 (`pnpm build`)
2. mock API 계약 테스트 (`pnpm test`)
3. Chromium 설치 및 브라우저 테스트 (`pnpm test:e2e`)

하나라도 실패하면 검사는 실패합니다. 자동 재시도로 실패를 숨기지 않으며 `test.only`가 남아 있으면 CI에서 실패합니다. 동일 PR에 새 커밋이 올라오면 이전 실행을 취소합니다. 한 실행은 최대 15분입니다.

## 결과 확인과 복구

PR의 Checks 또는 저장소 Actions → Frontend CI → 실행 기록에서 실패한 단계의 로그를 확인합니다. 브라우저 검사 결과는 `playwright-results` 아티팩트로 7일 보관합니다. 실패한 테스트의 trace와 스크린샷, HTML 보고서를 포함합니다. 테스트는 가상 계정과 mock 데이터만 사용합니다.

수정 커밋을 같은 PR 브랜치에 push하면 CI가 다시 실행됩니다. 일시적인 GitHub 장애일 때만 해당 실행의 Re-run failed jobs를 사용합니다. CI 성공은 실제 API·DB·NFC 장비의 성공을 의미하지 않습니다.

## 병합 규칙

팀 운영 기준은 `Frontend checks` 통과 + 다른 팀원 1명 승인입니다. CI 자체는 병합이나 배포를 수행하지 않습니다.

GitHub의 브랜치 보호 설정은 저장소 파일과 별개입니다. 지원되는 요금제와 관리자 권한으로 `develop`과 `main`에 각각 다음을 지정해야 강제됩니다.

- PR을 통한 병합 및 승인 1명 요구
- 새 커밋이 올라오면 이전 승인 무효화
- 필수 검사: `Frontend checks` (GitHub Actions)
- 병합 전 대상 브랜치 최신 상태 요구
- 관리자도 규칙 적용, 강제 push 및 삭제 금지

파일이 존재하거나 CI가 통과했다는 이유만으로 보호 규칙까지 적용된 것으로 간주하지 않습니다. 현재 적용 여부는 GitHub Settings → Branches에서 확인합니다.

2026-10-05 설정 화면에서 이 비공개 저장소는 현재 계정 조건으로 보호 규칙이 강제되지 않는다는 안내를 확인했습니다. 따라서 위 기준은 현재 팀 운영 규칙이며 자동 병합 차단이 적용된 상태가 아닙니다. 요금제·계정 변경은 수행하지 않았습니다. 지원 조건을 갖춘 뒤 위 규칙을 설정하고 실제 차단 여부를 확인해야 합니다.

## 백엔드 후속 범위

2026-10-05 DB 환경과 NFC 기본 구조가 `develop`에 통합되었습니다. 현재 CI는 여전히 프론트엔드만 검증합니다. Java 21, Gradle Wrapper, 테스트 전용 PostgreSQL 17 service container를 이용한 백엔드 빌드·테스트와 Flyway 검증은 별도 job으로 추가해야 합니다. 운영 DB나 개인 DB 비밀번호는 CI에서 사용하지 않습니다. NFC 하드웨어 검증은 별도의 현장 테스트가 필요합니다.
