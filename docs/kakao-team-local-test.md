# 팀원용 카카오 인증 로컬 시험

이 안내는 Windows 팀원 한 명이 자신의 노트북에서 격리된 시험 DB와 Docker 서버를 사용해 실제 카카오톡 인증을 확인하는 절차다. 실사용 서비스나 운영 배포용이 아니다. 다른 팀원의 PC·DB와 계정은 공유되지 않는다. 이 절차를 다른 노트북에서 처음부터 재현하는 검증은 아직 남아 있다.

이 브랜치에 최신 develop을 합치면서 마이그레이션 번호가 변경되었다. 병합 전 카카오 인증 브랜치로 이미 만든 시험 DB는 Flyway 검증에 실패할 수 있다. 기존 볼륨을 임의로 삭제하거나 repair하지 말고, 데이터를 보존한 뒤 새 격리 시험 DB로 검증한다. 기존 데이터의 이전은 별도로 계획한다.

## 준비와 협의

- Docker Desktop을 실행하고 Linux 컨테이너 엔진과 인터넷 연결을 확인한다. 명령은 저장소 루트에서 PowerShell로 실행한다. 기본 HTTPS 포트 `8443`이 이미 사용 중이면 해당 프로세스를 확인하고, 임의로 종료하거나 기존 DB를 건드리지 않는다.
- 카카오톡 시험 계정과 TagBack 채널·챗봇 관리자 접근이 필요하다. 동일 챗봇의 스킬은 하나의 주소를 사용하므로 **팀원끼리 순서를 정해 한 명씩 시험**한다. 스킬 설정·배포를 변경하면 현재 연결된 다른 사람의 시험이 중단될 수 있다.
- 공개된 채널에서 진행하는 시험은 사용자의 발화를 로컬 시험 서버로 보낸다. 실사용 계정과 데이터를 사용하지 않고, 채널 관리자와 시험 시간·종료 후 처리 방법을 사전에 공유한다. 봇 ID는 챗봇 관리자에게 확인한다.

## 1. 시험 비밀과 localhost 인증서 준비

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/compose/Initialize-KakaoAuthTest.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/compose/Initialize-Compose.ps1
```

첫 명령은 `deploy/compose/local/kakao-auth-test/`에 별도 시험 비밀을 생성하며 기존 값은 덮어쓰지 않는다. 두 번째 명령은 `deploy/compose/local/tls/`에 localhost용 자체 서명 인증서와 키를 준비하고 기본 Compose용 로컬 비밀도 생성한다. Docker 및 최초 이미지 다운로드가 필요하다. 인증서는 OS에 자동 등록되지 않는다.

시험 웹은 별도의 TLS 디렉터리를 사용한다. **처음 준비할 때만**, `deploy/compose/local/kakao-auth-test/tls/`가 아직 없으면 아래 명령을 실행한다. 이미 있으면 기존 파일의 출처와 쌍을 확인하고 덮어쓰지 않는다.

```powershell
Copy-Item -LiteralPath deploy/compose/local/tls -Destination deploy/compose/local/kakao-auth-test/tls -Recurse
```

로컬 디렉터리는 Git에서 제외되지만 암호화된 비밀 저장소는 아니다. 비밀·PIN·인증 코드·쿠키는 채팅, 이슈, 로그와 커밋에 올리지 않는다. 기존 DB를 유지하면서 DB 비밀번호 파일만 교체하면 접속이 깨질 수 있다.

## 2. 봇 ID와 시험 서버 시작

`deploy/compose/local/kakao-auth-test/bot.env`를 **UTF-8**로 만들고 다음 한 줄에 팀 관리자에게 확인한 봇 ID를 넣는다. 기존 파일이 있으면 먼저 확인하고 덮어쓰지 않는다. 봇 이름이나 채널 검색용 ID가 아니라 스킬 요청의 봇 ID다.

```text
TAGBACK_TEST_KAKAO_BOT_ID=여기에_실제_봇_ID
```

```powershell
docker compose --env-file deploy/compose/local/kakao-auth-test/bot.env -f deploy/compose/kakao-auth-test.yaml config --quiet
docker compose --env-file deploy/compose/local/kakao-auth-test/bot.env -f deploy/compose/kakao-auth-test.yaml up -d --build
docker compose -f deploy/compose/kakao-auth-test.yaml ps
docker compose -f deploy/compose/kakao-auth-test.yaml logs --tail 50 tunnel
```

DB·API·웹·프록시·터널이 실행되었는지 확인한다. 생성된 `https://…trycloudflare.com` 주소에 `/api/v1/auth/kakao/skill`을 붙인 것이 시험 스킬 URL이다. 터널을 다시 만들면 주소가 바뀔 수 있다. 이 프록시는 스킬 경로만 공개하고 사용자 웹은 이 노트북의 `https://localhost:8443/mobile`에서만 접근된다.

자체 서명 인증서 경고가 나타날 수 있다. 브라우저·기기에 신뢰된 localhost 인증서를 준비해 사용하는 것을 권장하며, 인증서 검증을 전역으로 끄지 않는다. 다른 PC·휴대폰에서 웹에 접속하는 것은 이 구성의 검증 범위가 아니다.

## 3. 공유 챗봇 연결과 실제 시험

1. 협의한 시험 차례에 카카오 챗봇 관리자센터에서 TagBack 인증 스킬의 URL과 Test URL을 위 시험 주소로 설정한다. 두 요청 헤더 `X-Tagback-Skill-Secret`에는 이 노트북의 `deploy/compose/local/kakao-auth-test/skill-secret` 값을 각각 설정한다. 파일 내용은 관리자 화면에서만 취급한다.
2. 스킬을 저장하고 **해당 스킬을 배포**한다. 저장만으로 실제 카카오톡에 배포된 버전이 갱신됐다고 가정하지 않는다. 기존 설정과 배포 이력을 확인하고, 다른 팀원 시험에 영향이 없도록 시험 차례와 종료 후 처리 방법을 조율한다.
3. 관리자센터 스킬 시험에서 서버 응답을 확인한다. 그다음 이 노트북의 시험 웹에서 프로필 입력 → 카카오톡 코드 입력 → PIN 설정으로 가입한다. 별도 시험 DB이므로 다른 노트북에서 만든 시험 계정은 자동으로 나타나지 않는다.
4. 등록 브라우저 PIN 로그인, 새 브라우저의 챗봇 인증 + PIN 로그인, PIN 재설정 및 취소·만료·재시도를 확인한다. 인증 코드는 원래 화면과 공식 채널에만 입력한다.

## 4. 시험 종료와 정리

시험 종료 전 공유 챗봇의 다음 사용자와 스킬 주소·헤더·배포 상태를 확인한다. 더 이상 사용할 수 없는 임시 터널 주소를 정상 서비스 주소로 오인하지 않게 팀에 알린다. 변경 이력을 모르는 상태에서 이전 설정을 추정해 복원하지 않는다.

```powershell
docker compose -f deploy/compose/kakao-auth-test.yaml stop
```

`stop`은 시험 DB 볼륨을 유지한다. 볼륨 삭제는 별도 결정이며 `down -v`는 실행하지 않는다. 시험 데이터의 보관·삭제와 백업은 팀이 대상과 범위를 확인한 후 처리한다. 기존 시험 키나 봇 연결로 실제 사용자 데이터를 관리하지 않는다.

## 현재 확인 범위

2026-11-23 이 저장소의 한 PC에서 실제 카카오톡 가입·로그인, PIN 재설정, 취소·만료·재시도와 채널 이동을 시험했다. 취소 후 이전 성공 문구가 사라지는 것도 새 웹 이미지에서 확인했다. 다른 팀원 노트북의 신규 설정, 실물 키오스크·NFC, 운영 환경, 동시 30명 부하는 아직 검증하지 않았다.
