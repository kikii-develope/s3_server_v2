# Git Branch Strategy

## 브랜치 구조

```
[main]           ← 프로덕션 배포 (태그: v1.0.0, v1.1.0, ...)
   ▲
   │ (PR 머지)
[release/v1.2.0] ← 릴리즈 준비 (QA, 버그픽스)
   ▲
   │ (PR 머지)
[develop]        ← 개발 통합 브랜치
   ▲
   │ (PR 머지)
[feature/*]      ← 기능 개발 브랜치

[hotfix/*]       → main에서 분기, main/develop에 머지
```

## 브랜치 설명

| 브랜치 | 용도 | 생성 위치 | 머지 대상 |
|--------|------|-----------|-----------|
| `main` | 프로덕션 배포 | - | - |
| `develop` | 개발 통합 | main | - |
| `feature/*` | 기능 개발 | develop | develop |
| `release/*` | 릴리즈 준비 | develop | main, develop |
| `hotfix/*` | 긴급 수정 | main | main, develop |

## 워크플로우

### 1. 기능 개발 (Feature)

```bash
# 1. develop에서 feature 브랜치 생성
git checkout develop
git pull origin develop
git checkout -b feature/기능명

# 2. 개발 작업 후 커밋
git add .
git commit -m "feat: 기능 설명"

# 3. develop에 PR 생성
git push origin feature/기능명
# GitHub에서 PR 생성: feature/기능명 → develop
```

### 2. 릴리즈 (Release)

```bash
# 1. develop에서 release 브랜치 생성
git checkout develop
git pull origin develop
git checkout -b release/v1.2.0

# 2. 버전 업데이트 및 QA 버그 수정
# package.json 버전 수정 등

# 3. main에 PR 생성 및 머지
git push origin release/v1.2.0
# GitHub에서 PR 생성: release/v1.2.0 → main

# 4. 태그 생성 (머지 후)
git checkout main
git pull origin main
git tag v1.2.0
git push origin v1.2.0

# 5. develop에도 머지
git checkout develop
git merge main
git push origin develop
```

### 3. 핫픽스 (Hotfix)

```bash
# 1. main에서 hotfix 브랜치 생성
git checkout main
git pull origin main
git checkout -b hotfix/버그명

# 2. 수정 후 커밋
git add .
git commit -m "fix: 버그 수정"

# 3. main에 PR 생성 및 머지
git push origin hotfix/버그명
# GitHub에서 PR 생성: hotfix/버그명 → main

# 4. 태그 생성 (머지 후)
git checkout main
git pull origin main
git tag v1.2.1
git push origin v1.2.1

# 5. develop에도 머지
git checkout develop
git merge main
git push origin develop
```

## CI/CD 자동화

### 트리거 조건

| 이벤트 | 브랜치/태그 | 동작 |
|--------|-------------|------|
| PR | `main`, `develop` | 빌드 테스트 |
| Push | `main` | Docker 빌드 → `latest` 태그로 푸시 |
| Push | `v*` 태그 | Docker 빌드 → 버전 태그로 푸시 |

### Docker 이미지 태그

- `kikidockerhub/file-server:latest` - main 브랜치 최신
- `kikidockerhub/file-server:1.2.0` - 릴리즈 버전
- `kikidockerhub/file-server:sha-abc1234` - 커밋 SHA

## 커밋 메시지 컨벤션

```
<type>: <subject>

[body]

[footer]
```

### Type

- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅
- `refactor`: 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드, 설정 변경

### 예시

```
feat: 파일 업로드 중복 파일명 자동 처리

- 중복 파일 발견 시 파일명(1), 파일명(2) 형태로 변경
- uploadSingle, uploadMultipleFilesParallel 함수 적용
```

## GitHub 설정 권장사항

### Branch Protection Rules (main)

- [x] Require pull request before merging
- [x] Require status checks to pass
- [x] Require branches to be up to date
- [ ] Allow force pushes (비활성화)
- [ ] Allow deletions (비활성화)

### Branch Protection Rules (develop)

- [x] Require pull request before merging
- [x] Require status checks to pass
