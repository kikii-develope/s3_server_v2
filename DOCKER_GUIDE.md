# Docker 환경별 사용 가이드

## 환경별 특징

### 개발 환경 (Development)
- **파일**: `Dockerfile.dev`, `docker-compose.dev.yml`
- **특징**:
  - nodemon을 사용하여 파일 변경 시 자동 재시작
  - 소스 코드 볼륨 마운트로 실시간 반영
  - 상세한 로그 출력
  - 개발 도구 포함

### 운영 환경 (Production)
- **파일**: `Dockerfile`, `docker-compose.prod.yml`
- **특징**:
  - 최적화된 이미지 크기
  - 프로덕션 의존성만 설치
  - 리소스 제한 설정
  - 보안 강화

## 사용 방법

### 개발 환경 실행
```bash
# 개발 환경 실행 (로그 확인)
npm run docker:dev

# 개발 환경 백그라운드 실행
npm run docker:dev:detach

# 개발 환경 중지
npm run docker:stop:dev
```

### 운영 환경 실행
```bash
# 운영 환경 실행 (로그 확인)
npm run docker:prod

# 운영 환경 백그라운드 실행
npm run docker:prod:detach

# 운영 환경 중지
npm run docker:stop:prod
```

### 직접 Docker 명령어 사용
```bash
# 개발 환경
docker-compose -f docker-compose.dev.yml up --build

# 운영 환경
docker-compose -f docker-compose.prod.yml up --build
```

## 환경변수 설정

`.env` 파일을 생성하여 환경변수를 설정하세요:

```env
# AWS 설정
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-northeast-2

# 서버 설정 (개발: 8888, 운영: 80)
PORT=8888
NODE_ENV=development
```

## 접속 URL

### 개발 환경
- **API 서버**: `http://localhost:8888`
- **Swagger UI**: `http://localhost:8888/swagger-ui.html`

### 운영 환경
- **API 서버**: `http://localhost:80` (또는 `http://localhost`)
- **Swagger UI**: `http://localhost:80/swagger-ui.html`

## 주의사항
1. **개발 환경**: 소스 코드 변경 시 자동으로 재시작됩니다
2. **운영 환경**: 보안을 위해 `.env` 파일을 별도로 관리하세요
3. **로그 확인**: `docker-compose logs -f [서비스명]`으로 실시간 로그 확인 가능 