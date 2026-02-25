#!/usr/bin/env node

/**
 * WebDAV Upload API Test Script
 *
 * 테스트 항목:
 *   1. 서버 정보 조회 (GET /webdav/info)
 *   2. 소용량 단일 파일 업로드 (5MB) — 병렬 해시+업로드
 *   3. 대용량 단일 파일 업로드 (120MB) — 청크 업로드 + 순차 해시
 *   4. 다중 파일 업로드 (3개, 각 3MB) — 동시성 + 파일명 예약
 *   5. 중복 파일명 업로드 — 자동 리네임 (1), (2)
 *   6. 디렉토리 존재 확인 (GET /webdav/directory/:path)
 *   7. 파일 다운로드 (GET /webdav/download/:path)
 *   8. 파일 삭제 (DELETE /webdav/file/:path)
 *   9. 디렉토리 삭제 (DELETE /webdav/directory/:path)
 *  10. 메모리 통계 조회 (GET /webdav/stats)
 *
 * 사용법:
 *   node test/webdav-test.mjs                   # 기본 (localhost:8000)
 *   node test/webdav-test.mjs http://host:port   # 커스텀 서버
 *   node test/webdav-test.mjs --skip-large       # 120MB 테스트 스킵
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// ─── 설정 ────────────────────────────────────────────────────
const BASE_URL = process.argv[2]?.startsWith('http')
  ? process.argv[2].replace(/\/$/, '')
  : 'http://localhost:8000';
const API = `${BASE_URL}/webdav`;
const SKIP_LARGE = process.argv.includes('--skip-large');
const TEST_PATH = `_upload_test_${Date.now()}`;
const TEMP_DIR = path.join(os.tmpdir(), `webdav-test-${Date.now()}`);

// 테스트 결과 추적
const results = [];
let uploadedFiles = [];  // cleanup용

// ─── 유틸 ────────────────────────────────────────────────────
const log = (icon, msg) => console.log(`  ${icon} ${msg}`);
const header = (title) => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
};

const formatSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const createTestFile = (name, sizeBytes) => {
  const filePath = path.join(TEMP_DIR, name);
  const fd = fs.openSync(filePath, 'w');
  const chunkSize = 1024 * 1024; // 1MB씩 쓰기
  let remaining = sizeBytes;

  while (remaining > 0) {
    const size = Math.min(chunkSize, remaining);
    const buf = crypto.randomBytes(size);
    fs.writeSync(fd, buf);
    remaining -= size;
  }

  fs.closeSync(fd);
  return filePath;
};

const makeFormData = (fields, files) => {
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  for (const { fieldName, filePath, fileName } of files) {
    const buffer = fs.readFileSync(filePath);
    const blob = new Blob([buffer]);
    formData.append(fieldName, blob, fileName);
  }

  return formData;
};

const runTest = async (name, fn) => {
  const start = Date.now();
  try {
    await fn();
    const dur = ((Date.now() - start) / 1000).toFixed(2);
    results.push({ name, status: 'PASS', duration: dur });
    log('PASS', `${name} (${dur}s)`);
  } catch (err) {
    const dur = ((Date.now() - start) / 1000).toFixed(2);
    results.push({ name, status: 'FAIL', duration: dur, error: err.message });
    log('FAIL', `${name} (${dur}s)`);
    log('   ', `Error: ${err.message}`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
};

// ─── 테스트 케이스 ──────────────────────────────────────────

async function testServerInfo() {
  const res = await fetch(`${API}/info`);
  const data = await res.json();
  assert(res.status === 200, `status=${res.status}`);
  assert(data.baseUrl, `baseUrl missing: ${JSON.stringify(data)}`);
  log('   ', `Server: ${data.baseUrl}`);
}

async function testSingleUploadSmall() {
  const filePath = createTestFile('test_small_5mb.txt', 5 * 1024 * 1024);
  const formData = makeFormData(
    { path: TEST_PATH },
    [{ fieldName: 'file', filePath, fileName: 'test_small_5mb.txt' }]
  );

  const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
  const data = await res.json();

  assert(res.status === 200, `status=${res.status}, msg=${data.message}`);
  assert(data.filename, 'filename missing');
  assert(data.uploadType === 'single', `uploadType=${data.uploadType}`);
  assert(data.etag, 'etag missing');
  assert(data.stats, 'stats missing');

  uploadedFiles.push(`${TEST_PATH}/${data.filename}`);

  log('   ', `File: ${data.filename} (${formatSize(data.size)})`);
  log('   ', `Type: ${data.uploadType} | ETag: ${data.etag}`);
  log('   ', `Upload: ${data.stats.uploadSeconds}s | Hash: ${data.stats.hashSeconds}s | Total: ${data.stats.totalWallClockSeconds}s`);
  log('   ', `Memory: ${data.stats.memoryHeapUsedMB}MB (${data.stats.memoryIncreaseMB > 0 ? '+' : ''}${data.stats.memoryIncreaseMB}MB)`);
}

async function testSingleUploadLarge() {
  log('   ', '120MB 테스트 파일 생성 중...');
  const filePath = createTestFile('test_large_120mb.bin', 120 * 1024 * 1024);
  log('   ', '120MB 파일 생성 완료, 업로드 시작...');

  const formData = makeFormData(
    { path: TEST_PATH },
    [{ fieldName: 'file', filePath, fileName: 'test_large_120mb.bin' }]
  );

  const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
  const data = await res.json();

  assert(res.status === 200, `status=${res.status}, msg=${data.message}`);
  assert(data.filename, 'filename missing');
  assert(data.uploadType === 'multipart', `uploadType=${data.uploadType}, expected multipart`);
  assert(data.chunks > 1, `chunks=${data.chunks}`);
  assert(data.etag, 'etag missing');

  uploadedFiles.push(`${TEST_PATH}/${data.filename}`);

  log('   ', `File: ${data.filename} (${formatSize(data.size)})`);
  log('   ', `Type: ${data.uploadType} | Chunks: ${data.chunks} | ETag: ${data.etag}`);
  log('   ', `Upload: ${data.stats.uploadSeconds}s | Hash: ${data.stats.hashSeconds}s | Speed: ${data.stats.uploadSpeedMBps} MB/s`);
  log('   ', `Total: ${data.stats.totalWallClockSeconds}s | Memory: ${data.stats.memoryHeapUsedMB}MB`);
}

async function testMultiUpload() {
  const files = [
    { name: 'multi_a.txt', size: 3 * 1024 * 1024 },
    { name: 'multi_b.txt', size: 3 * 1024 * 1024 },
    { name: 'multi_c.txt', size: 3 * 1024 * 1024 },
  ];

  const filePaths = files.map(f => createTestFile(f.name, f.size));
  const formData = new FormData();
  formData.append('path', TEST_PATH);
  formData.append('filenames', JSON.stringify(files.map(f => f.name)));

  for (let i = 0; i < files.length; i++) {
    const buffer = fs.readFileSync(filePaths[i]);
    const blob = new Blob([buffer]);
    formData.append('files', blob, files[i].name);
  }

  const res = await fetch(`${API}/upload-multiple`, { method: 'POST', body: formData });
  const data = await res.json();

  assert(res.status === 200, `status=${res.status}, msg=${data.message}`);
  assert(data.summary, 'summary missing');
  assert(data.summary.success === 3, `success=${data.summary.success}`);
  assert(data.summary.failed === 0, `failed=${data.summary.failed}`);

  for (const r of data.results) {
    if (r.success) uploadedFiles.push(`${TEST_PATH}/${r.filename}`);
  }

  log('   ', `Result: ${data.summary.success}/${data.summary.total} success`);
  log('   ', `Total: ${data.stats.totalWallClockSeconds}s | Size: ${data.stats.totalSizeMB}MB`);

  for (const r of data.results) {
    log('   ', `  ${r.success ? 'OK' : 'FAIL'} ${r.filename} (${r.durationSeconds}s)`);
  }
}

async function testDuplicateFilename() {
  // 같은 이름으로 2번 업로드 → 두번째는 (1)이 붙어야 함
  const filePath = createTestFile('dup_test.txt', 1 * 1024 * 1024);

  const formData1 = makeFormData(
    { path: TEST_PATH },
    [{ fieldName: 'file', filePath, fileName: 'dup_test.txt' }]
  );
  const res1 = await fetch(`${API}/upload`, { method: 'POST', body: formData1 });
  const data1 = await res1.json();
  assert(res1.status === 200, `first upload: status=${res1.status}`);
  uploadedFiles.push(`${TEST_PATH}/${data1.filename}`);

  const formData2 = makeFormData(
    { path: TEST_PATH },
    [{ fieldName: 'file', filePath, fileName: 'dup_test.txt' }]
  );
  const res2 = await fetch(`${API}/upload`, { method: 'POST', body: formData2 });
  const data2 = await res2.json();
  assert(res2.status === 200, `second upload: status=${res2.status}`);
  assert(data2.filename !== data1.filename, `duplicate not renamed: ${data2.filename} === ${data1.filename}`);
  assert(data2.filename.includes('(1)'), `expected (1) suffix: ${data2.filename}`);
  uploadedFiles.push(`${TEST_PATH}/${data2.filename}`);

  log('   ', `First:  ${data1.filename}`);
  log('   ', `Second: ${data2.filename} (auto-renamed)`);
}

async function testDirectoryCheck() {
  const res = await fetch(`${API}/directory/${TEST_PATH}`);
  const data = await res.json();
  assert(res.status === 200, `status=${res.status}`);
  assert(data.directory === true, `directory=${data.directory}`);
  log('   ', `${TEST_PATH} exists: ${data.directory}`);
}

async function testDownload() {
  if (uploadedFiles.length === 0) {
    log('   ', 'SKIP - no uploaded files');
    return;
  }

  const targetPath = uploadedFiles[0];
  const res = await fetch(`${API}/download/${targetPath}`);
  assert(res.status === 200, `status=${res.status}`);

  const contentLength = res.headers.get('content-length');
  assert(contentLength && parseInt(contentLength) > 0, `content-length=${contentLength}`);

  // consume body
  await res.arrayBuffer();

  log('   ', `Downloaded: ${targetPath} (${formatSize(parseInt(contentLength))})`);
}

async function testDeleteFiles() {
  let deleted = 0;
  let failed = 0;

  for (const filePath of uploadedFiles) {
    try {
      const res = await fetch(`${API}/file/${filePath}`, { method: 'DELETE' });
      if (res.status === 200) {
        deleted++;
      } else {
        failed++;
        const data = await res.json();
        log('   ', `  Delete failed: ${filePath} → ${data.message}`);
      }
    } catch (err) {
      failed++;
    }
  }

  log('   ', `Deleted: ${deleted}/${uploadedFiles.length} (failed: ${failed})`);
  assert(failed === 0, `${failed} files failed to delete`);
}

async function testDeleteDirectory() {
  const res = await fetch(`${API}/directory/${TEST_PATH}?force=true`, { method: 'DELETE' });
  const data = await res.json();
  assert(res.status === 200, `status=${res.status}, msg=${data.message}`);
  log('   ', `Directory deleted: ${TEST_PATH}`);
}

async function testStats() {
  const res = await fetch(`${API}/stats`);
  const data = await res.json();
  assert(res.status === 200, `status=${res.status}`);
  assert(data.memory, 'memory stats missing');

  log('   ', `Heap: ${data.memory.heapUsedMB}/${data.memory.heapTotalMB} MB`);
  log('   ', `RSS:  ${data.memory.rssMB} MB`);
  log('   ', `Uptime: ${Math.floor(data.uptime)}s`);
}

// ─── 실행 ────────────────────────────────────────────────────

async function main() {
  console.log('\n====================================================');
  console.log('  WebDAV Upload API Test');
  console.log('====================================================');
  console.log(`  Server:    ${BASE_URL}`);
  console.log(`  Test path: ${TEST_PATH}`);
  console.log(`  Temp dir:  ${TEMP_DIR}`);
  console.log(`  Skip large: ${SKIP_LARGE}`);
  console.log('====================================================');

  // 임시 디렉토리 생성
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  try {
    // 1. 서버 연결 확인
    header('1. Server Info');
    await runTest('GET /webdav/info', testServerInfo);

    // 2. 소용량 단일 업로드 (5MB)
    header('2. Single Upload - Small (5MB)');
    await runTest('POST /webdav/upload (5MB)', testSingleUploadSmall);

    // 3. 대용량 단일 업로드 (120MB) - 청크
    if (!SKIP_LARGE) {
      header('3. Single Upload - Large (120MB, Chunk)');
      await runTest('POST /webdav/upload (120MB)', testSingleUploadLarge);
    } else {
      header('3. Single Upload - Large (SKIPPED)');
      log('   ', '--skip-large 옵션으로 스킵됨');
    }

    // 4. 다중 파일 업로드 (3x3MB)
    header('4. Multi Upload (3 files, 3MB each)');
    await runTest('POST /webdav/upload-multiple', testMultiUpload);

    // 5. 중복 파일명 테스트
    header('5. Duplicate Filename');
    await runTest('POST /webdav/upload (duplicate)', testDuplicateFilename);

    // 6. 디렉토리 확인
    header('6. Directory Check');
    await runTest('GET /webdav/directory/:path', testDirectoryCheck);

    // 7. 파일 다운로드
    header('7. File Download');
    await runTest('GET /webdav/download/:path', testDownload);

    // 8. 메모리 통계
    header('8. Server Stats');
    await runTest('GET /webdav/stats', testStats);

    // 9. 파일 삭제
    header('9. Cleanup - Delete Files');
    await runTest('DELETE /webdav/file/:path', testDeleteFiles);

    // 10. 디렉토리 삭제
    header('10. Cleanup - Delete Directory');
    await runTest('DELETE /webdav/directory/:path', testDeleteDirectory);

  } finally {
    // 로컬 임시 파일 정리
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch {}
  }

  // 결과 요약
  console.log('\n====================================================');
  console.log('  TEST RESULTS');
  console.log('====================================================');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;

  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`  ${icon}  ${r.name} (${r.duration}s)${r.error ? ` - ${r.error}` : ''}`);
  }

  console.log('────────────────────────────────────────────────────');
  console.log(`  Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('====================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
