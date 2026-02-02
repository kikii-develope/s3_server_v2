# 환경 설정 가이드

## 환경별 설정 파일

프로젝트는 3가지 환경을 지원합니다:

| 환경 | 파일 | 포트 | WebDAV 경로 | NODE_ENV |
|------|------|------|-------------|----------|
| 개발 (로컬) | `.env.development` | 8000 | /kikii_test | development |
| 온프레미스 | `.env.onprem` | 8989 | /kikii_test | onprem |
| 운영 (클라우드) | `.env.production` | 80 | /www | production |

## 환경별 실행 방법

### 1. 로컬 개발 환경
```bash
npm run dev
```
- `.env.development` 파일 사용
- 포트 8000에서 실행
- Hot reload 지원

### 2. 온프레미스 환경
```bash
npm run dev:onprem
```
- `.env.onprem` 파일 사용
- 포트 8989에서 실행

### 3. 운영 환경
```bash
npm run start
```
- `.env.production` 파일 사용
- 포트 80에서 실행
- GitHub Actions를 통한 자동 배포

## Docker 환경

### 개발 환경
```bash
./scripts/build-dev.sh
docker run -d -p 8000:8000 --env-file .env.development --name file-server-dev file-server:dev
```

### 온프레미스 환경
```bash
./scripts/build-onprem.sh
docker run -d -p 8989:8989 --env-file .env.onprem --name file-server-onprem file-server:onprem
```

### 운영 환경
```bash
./scripts/build-prod.sh
docker run -d -p 80:80 --env-file .env.production --name file-server-prod file-server:prod
```

## 환경 변수 설명

### 필수 환경 변수

#### AWS 설정
- `AWS_IAM_USER_KEY`: AWS IAM 액세스 키
- `AWS_IAM_USER_SECRET`: AWS IAM 시크릿 키
- `AWS_REGION`: AWS 리전 (기본값: ap-northeast-2)

#### WebDAV 설정
- `WEBDAV_URL`: WebDAV 서버 URL
- `WEBDAV_USER`: WebDAV 사용자명
- `WEBDAV_PASSWORD`: WebDAV 비밀번호
- `WEBDAV_ROOT_PATH`: WebDAV 루트 경로
  - 개발/온프레미스: `kikii_test`
  - 운영: `www`

#### 서버 설정
- `PORT`: 서버 포트 번호
- `NODE_ENV`: 실행 환경 (development, onprem, production)

#### 데이터베이스 설정
- `DB_HOST`: 데이터베이스 호스트
- `DB_PORT`: 데이터베이스 포트
- `DB_USER`: 데이터베이스 사용자명
- `DB_PASSWORD`: 데이터베이스 비밀번호
- `DB_NAME`: 데이터베이스 이름

## 초기 설정

1. `.env.example` 파일을 복사하여 환경별 파일 생성:
```bash
cp .env.example .env.development
cp .env.example .env.onprem
cp .env.example .env.production
```

2. 각 파일의 환경 변수 값을 실제 값으로 수정

3. 환경에 맞는 명령어로 실행

## 주의사항

- `.env*` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다
- 실제 환경 변수 값은 절대 공개 저장소에 커밋하지 마세요
- `.env.example`은 템플릿이므로 실제 값을 포함하지 않습니다
