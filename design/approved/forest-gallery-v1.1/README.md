# TagBack Design Handoff v1.1
2026-11-27 | Forest Gallery V3 | 사용자 웹·관리자 웹·Windows 키오스크 디자인 방향 승인

## 사용 순서
1. CODEX_PROMPT.md를 Codex에 전달하고 이 폴더 전체를 프로젝트에서 읽을 수 있게 제공한다.
2. 프로젝트 개발 지침, SERVICE_REQUIREMENTS.md, DESIGN_SYSTEM.md, DESIGN_TOKENS.json을 검토한다.
3. IMPLEMENTATION_GUIDE.md 및 specifications/의 화면별 명세를 읽고 design-images/IMAGE_INDEX.md에서 이미지 ID를 찾는다.
4. OPEN_ISSUES.md의 확인 항목을 기존 저장소와 대조한다. QA_CHECKLIST.md로 실제 렌더링 및 기능 검수한다.

## 범위 및 우선순위
개발 지침/보안 → 확정 서비스 요구사항 → 최종 명세/토큰 → 승인 방향의 참조 이미지 → 기존 시각 스타일. 충돌이 있으면 근거와 해결책을 보고한다. 기존 기능/서버 계약을 임의로 변경하지 않는다.

34개 기본 화면 PNG(PC 6, 모바일 6, 관리자 9, 키오스크 13). 초기 탐색안과 잘못 생성된 중복 시안은 제외했다. 개별 이미지는 수정 지침을 수반하는 참조용이며 최종 픽셀 사양이 아니다. 이미지 원본의 실제 크기는 manifest.json에 기록했다. AD-05는 물품 종류별 집계 이미지로, 개별 실물 단위 화면은 명세로 보완한다. 별도 물품 수정 이미지, 모달, 모든 로딩/오류 변형 이미지는 포함하지 않는다. 실제 코드 및 실행 환경은 검사하지 않았다. 본 패키지는 구현물이 아니다.
