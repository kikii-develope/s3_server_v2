# WebDAV Server Test Suite

운영 수준의 테스트 자동화 스크립트 세트입니다. 업로드/다운로드 기능 검증, 레이스 컨디션, 장애 주입,
리소스 누수 탐지까지 포함합니다.

## 파일 구조

```
test/
├── README.md
├── scripts/
│   ├── _common.sh                  # 공통 설정, 헬퍼 함수
│   ├── gen_test_files.sh           # 테스트 파일 생성 (1MB~1.5GB)
│   ├── single_upload.sh            # 단일 파일 업로드 테스트
│   ├── multi_upload.sh             # 다중 파일 업로드 테스트
│   ├── range_download_loop.sh      # Range 다운로드 100회 반복 (누수 탐지)
│   ├── dir_race_same_name.sh       # 동일 파일명 동시 업로드 레이스 테스트
│   ├── chaos_kill_during_upload.sh # 업로드 중 서버 kill + 재시도
│   ├── tmp_disk_pressure.sh        # /tmp 디스크 압박 테스트
│   ├── webdav_fault.sh             # WebDAV 백엔드 장애 주입
│   └── run_all.sh                  # 전체 시나리오 실행 + 요약 리포트
├── k6/
│   └── load_test.js                # k6 부하 테스트 (선택)
├── test_files/                     # 생성된 테스트 파일 (gitignore)
└── results/                        # 테스트 결과 (JSONL + 아카이브)
```

## 환경 요구사항

| 요구사항 | 비고 |
|---------|------|
| macOS / Linux | macOS 우선, Linux 호환 |
| bash 3.2+ | macOS 기본 bash 호환 |
| curl | 기본 설치됨 |
| python3 | JSON 파싱용 (jq 없을 때 fallback) |
| Node.js + npm | 서버 실행용 |
| k6 (선택) | 부하 테스트용. `brew install k6` |

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BASE_URL` | `http://localhost:8000` | 테스트 대상 서버 URL |
| `UPLOAD_PATH` | `test-automation` | WebDAV 업로드 기본 경로 |
| `GENERATE_LARGE` | `0` | `1`로 설정하면 1GB/1.5GB 파일도 생성 |

## 빠른 시작

```bash
# 1. 서버 시작 (별도 터미널)
cd /path/to/s3_server_v2
npm run dev

# 2. 테스트 파일 생성
cd test/scripts
chmod +x *.sh
./gen_test_files.sh            # 1MB, 50MB, 120MB
./gen_test_files.sh --large    # + 1GB, 1.5GB

# 3. 개별 테스트 실행
./single_upload.sh
./multi_upload.sh
./dir_race_same_name.sh 8
./range_download_loop.sh 100

# 4. 전체 실행
./run_all.sh                   # 기본 (120MB까지)
./run_all.sh --large           # 1.5GB까지 포함
```

## 테스트 시나리오 상세

### Phase 1: 기본 성능 (single_upload + multi_upload)
- 1MB, 50MB, 120MB 파일 업로드
- HTTP 200, ETag 포함 확인
- 업로드 속도 (MB/s) 측정
- 다중 업로드 summary 검증

### Phase 2: 동일 파일명 레이스 (dir_race_same_name)
- 같은 파일명 N개 동시 업로드 (기본 8)
- 모든 파일 성공, 파일명 중복 없음 확인
- 네이밍 패턴 검증: `a.bin`, `a(1).bin`, `a(2).bin`...
- `reservedFilenames` 인메모리 예약의 정확성 검증

### Phase 3: Chaos Kill (chaos_kill_during_upload)
- 120MB 업로드 진행 중 3초 후 서버 SIGKILL
- tmpdir 잔여 파일 확인 (multer tmp, merge-* 폴더)
- 서버 재시작 후 동일 파일 재업로드
- stale filename reservation 누수 확인
- 메모리/FD 정상 범위 확인

> **주의**: 실행 중인 dev 서버를 kill합니다. 테스트 후 서버는 백그라운드에서 재시작됩니다.

### Phase 4: 디스크 압박 (tmp_disk_pressure)
- `/tmp`에 더미 파일로 여유 공간 ~200MB까지 축소
- 120MB 업로드 시도 → 정상적인 에러 응답 확인 (timeout이 아닌 HTTP 에러)
- 압박 해제 후 정상 업로드 복구 확인
- 안전장치: 2GB 미만이면 스킵, 최대 4GB만 채움

### Phase 5: WebDAV 장애 (webdav_fault)
- 포트 8099에 broken WEBDAV_URL로 별도 서버 인스턴스 기동
- 업로드/디렉토리 생성 → 적절한 HTTP 에러 반환 확인
- 서버 crash 없이 에러 처리 확인
- 원래 서버에 영향 없음 확인

### Phase 6: Range 다운로드 (range_download_loop)
- 120MB 파일에 대해 100회 랜덤 Range 요청
- HTTP 206 + `Content-Range` 헤더 일관성 확인
- FD 카운트 증가폭 50 이하 확인 (누수 탐지)
- 서버 로그에 `MaxListeners` 경고 없음 확인

### Phase 7: k6 부하 테스트 (선택)
- single upload: 3 VU, 30초
- multi upload: 2 VU, 30초
- range download: 20 req/s, 20초
- 실패율 < 10%, p95 latency 기준 검증

## 리소스 모니터링

모든 시나리오에서 시작/종료 시 자동 수집:

| 메트릭 | 소스 |
|--------|------|
| Heap Used (MB) | `GET /webdav/stats` → `data.memory.heapUsedMB` |
| RSS (MB) | `GET /webdav/stats` → `data.memory.rssMB` |
| CPU (%) | `GET /webdav/stats` → `data.cpu.percent` |
| FD Count | `lsof -p <pid>` (macOS) / `/proc/<pid>/fd` (Linux) |

결과는 `results/results.jsonl`에 JSON Lines 형태로 기록되며,
`run_all.sh` 종료 시 요약 테이블로 출력됩니다.

## 결과 파일

| 파일 | 내용 |
|------|------|
| `results/results.jsonl` | 시나리오별 결과 (status, duration, resource delta) |
| `results/results_YYYYMMDD_HHMMSS.jsonl` | 타임스탬프 아카이브 |
| `results/server.log` | chaos 테스트 시 서버 로그 |
| `results/fault_server.log` | WebDAV fault 테스트 서버 로그 |
| `results/k6_results.json` | k6 상세 결과 (k6 실행 시) |

## 추천 실행 순서

```
기본 성능 → 레이스 → chaos → 디스크 압박 → WebDAV 장애 → Range 누수
```

`run_all.sh`가 이 순서대로 실행합니다.

## 주의사항

1. **chaos 테스트**: 실행 중인 dev 서버를 kill합니다. 중요한 작업 중에는 실행하지 마세요.
2. **디스크 압박**: `/tmp` 여유 공간을 소진합니다. 실행 중 중단하면 `trap`이 정리하지만, 수동 정리가 필요할 수 있습니다:
   ```bash
   rm -rf $(node -e "console.log(require('os').tmpdir())")/webdav-pressure-test
   ```
3. **대용량 파일**: 1.5GB 파일 생성 + 업로드에 수분~수십분 소요됩니다.
4. **WebDAV fault 테스트**: 포트 8099를 사용합니다. 다른 서비스와 충돌하지 않는지 확인하세요.
5. **test_files/**: `.gitignore`에 추가하는 것을 권장합니다.
