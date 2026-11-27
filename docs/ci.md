# 자동 CI

## 실행 범위

`.github/workflows/frontend-ci.yml`은 `develop` 또는 `main`을 대상으로 PR을 만들거나 갱신할 때, 두 브랜치에 push할 때 실행됩니다. 문서만 바꾸는 PR도 실행하여 필수 검사가 대기 상태로 남지 않도록 합니다.

검사 이름은 `Frontend checks`입니다. Ubuntu에서 Node.js 24.19.0과 pnpm 11.19.0을 사용하며 lockfile을 변경하지 않고 의존성을 설치합니다.

1. TypeScript 검사 및 Vite 프로덕션 빌드 (`pnpm build`)
2. API 어댑터 테스트 (`pnpm test`)
3. Chromium 설치 및 브라우저 테스트 (`pnpm test:e2e`)
4. NFC 브리지 브라우저 테스트 (`pnpm exec playwright test -c playwright.bridge.config.ts`)

하나라도 실패하면 검사는 실패합니다. 동일 PR에 새 커밋이 올라오면 이전 실행을 취소합니다. 한 실행은 최대 15분입니다.

## 결과 확인과 복구

PR의 Checks 또는 저장소 Actions → Frontend CI → 실행 기록에서 실패한 단계의 로그를 확인합니다.

취소되지 않은 실행은 생성된 브라우저 검사 결과를 `playwright-results` 아티팩트로 업로드하며 7일간 보관합니다. 포함되는 스크린샷과 보고서는 테스트 설정과 실제 생성된 파일에 따라 달라집니다. 테스트에는 응답 fixture와 가상 NFC 이벤트를 사용합니다.

수정 커밋을 같은 PR 브랜치에 push하면 CI가 다시 실행됩니다. 일시적인 GitHub 장애일 때만 해당 실행의 Re-run failed jobs를 사용합니다. CI 성공은 실제 API·DB·NFC 장비의 성공을 의미하지 않습니다.

## 병합 규칙

2026-10-07부터 [기여 안내의 PR·병합 운영 기준](../CONTRIBUTING.md)을 따릅니다.

- `develop` 대상 PR은 팀장(치우)이 직접 승인·병합합니다.
- PR 요청 후 코멘트나 별도 사용자 요청이 없으면 에이전트는 추가 작업을 수행하지 않습니다.
- 그 외 대상은 본인 브랜치끼리 PR 없이 병합합니다.
- 팀원 브랜치와의 병합은 해당 팀원과 충분히 소통한 후 진행합니다.

CI 자체는 병합이나 배포를 수행하지 않습니다.

GitHub의 브랜치 보호 설정은 저장소 파일과 별개입니다. 워크플로가 존재하거나 CI가 통과했다고 해서 필수 검사나 승인 규칙이 강제되는 것은 아닙니다. 실제 적용 여부는 GitHub Settings의 브랜치 보호 규칙과 ruleset에서 확인합니다.

## 별도 검증 범위

이 워크플로는 프론트엔드 검사만 수행합니다. 백엔드 빌드·테스트, PostgreSQL과 Flyway를 포함한 통합 검증, 실제 카카오톡 로그인 및 NFC 하드웨어 검증은 별도로 수행하고 결과를 PR에 기록합니다.

백엔드 CI를 추가할 때는 테스트 전용 DB와 비밀값을 사용합니다.
