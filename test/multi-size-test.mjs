#!/usr/bin/env node

/**
 * 다양한 파일 크기 & 갯수 조합 테스트
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

const API = 'http://localhost:8000/webdav';
const TEMP = path.join(os.tmpdir(), `multi-size-test-${Date.now()}`);
fs.mkdirSync(TEMP, { recursive: true });

const formatSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
};

// 파일 생성 (스트림 방식)
function createFile(name, sizeBytes) {
  const filePath = path.join(TEMP, name);
  const fd = fs.openSync(filePath, 'w');
  let remaining = sizeBytes;
  const chunk = 1024 * 1024;
  while (remaining > 0) {
    const size = Math.min(chunk, remaining);
    fs.writeSync(fd, crypto.randomBytes(size));
    remaining -= size;
  }
  fs.closeSync(fd);
  return filePath;
}

// 단일 업로드
async function singleUpload(testPath, filePath, fileName) {
  const formData = new FormData();
  const buf = fs.readFileSync(filePath);
  formData.append('file', new Blob([buf]), fileName);
  formData.append('path', testPath);

  const start = Date.now();
  const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
  const dur = ((Date.now() - start) / 1000).toFixed(2);
  const data = await res.json();
  return { status: res.status, dur, data };
}

// 다중 업로드
async function multiUpload(testPath, files) {
  const formData = new FormData();
  formData.append('path', testPath);
  const filenames = files.map(f => f.name);
  formData.append('filenames', JSON.stringify(filenames));

  for (const f of files) {
    const buf = fs.readFileSync(f.path);
    formData.append('files', new Blob([buf]), f.name);
  }

  const start = Date.now();
  const res = await fetch(`${API}/upload-multiple`, { method: 'POST', body: formData });
  const dur = ((Date.now() - start) / 1000).toFixed(2);
  const data = await res.json();
  return { status: res.status, dur, data };
}

// 정리
async function cleanup(testPath) {
  await fetch(`${API}/directory/${encodeURIComponent(testPath)}?force=true`, { method: 'DELETE' });
}

// 메모리 조회
async function getMemory() {
  const res = await fetch(`${API}/stats`);
  const data = await res.json();
  return data.memory;
}

// ─── 테스트 시나리오 ───────────────────────────────
const scenarios = [
  {
    name: '소형 파일 1개 (1MB)',
    type: 'single',
    files: [{ name: 'small_1mb.bin', size: 1 * 1024 * 1024 }],
  },
  {
    name: '소형 파일 3개 (각 1MB)',
    type: 'multi',
    files: [
      { name: 'small_a.bin', size: 1 * 1024 * 1024 },
      { name: 'small_b.bin', size: 1 * 1024 * 1024 },
      { name: 'small_c.bin', size: 1 * 1024 * 1024 },
    ],
  },
  {
    name: '중형 파일 1개 (50MB)',
    type: 'single',
    files: [{ name: 'mid_50mb.bin', size: 50 * 1024 * 1024 }],
  },
  {
    name: '중형 파일 5개 (각 20MB)',
    type: 'multi',
    files: Array.from({ length: 5 }, (_, i) => ({
      name: `mid_20mb_${i + 1}.bin`,
      size: 20 * 1024 * 1024,
    })),
  },
  {
    name: '혼합 3개 (1MB + 30MB + 80MB)',
    type: 'multi',
    files: [
      { name: 'mix_1mb.bin', size: 1 * 1024 * 1024 },
      { name: 'mix_30mb.bin', size: 30 * 1024 * 1024 },
      { name: 'mix_80mb.bin', size: 80 * 1024 * 1024 },
    ],
  },
  {
    name: '대형 파일 1개 (150MB, 청크)',
    type: 'single',
    files: [{ name: 'large_150mb.bin', size: 150 * 1024 * 1024 }],
  },
  {
    name: '혼합 4개 (5MB + 10MB + 120MB + 2MB)',
    type: 'multi',
    files: [
      { name: 'mix4_5mb.bin', size: 5 * 1024 * 1024 },
      { name: 'mix4_10mb.bin', size: 10 * 1024 * 1024 },
      { name: 'mix4_120mb.bin', size: 120 * 1024 * 1024 },
      { name: 'mix4_2mb.bin', size: 2 * 1024 * 1024 },
    ],
  },
  {
    name: '소형 10개 (각 2MB)',
    type: 'multi',
    files: Array.from({ length: 10 }, (_, i) => ({
      name: `batch_2mb_${String(i + 1).padStart(2, '0')}.bin`,
      size: 2 * 1024 * 1024,
    })),
  },
];

// ─── 실행 ─────────────────────────────────────────
async function main() {
  console.log('==========================================================');
  console.log('  Multi-Size Upload Test');
  console.log('==========================================================\n');

  const initialMem = await getMemory();
  console.log(`Initial Memory: Heap ${initialMem.heapUsedMB}/${initialMem.heapTotalMB}MB | RSS ${initialMem.rssMB}MB\n`);

  const results = [];

  for (let si = 0; si < scenarios.length; si++) {
    const s = scenarios[si];
    const testPath = `_multi_size_test_${Date.now()}_${si}`;
    const totalSize = s.files.reduce((a, f) => a + f.size, 0);

    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`[${si + 1}/${scenarios.length}] ${s.name}`);
    console.log(`  Files: ${s.files.length}개 | Total: ${formatSize(totalSize)} | Type: ${s.type}`);

    // 파일 생성
    const createdFiles = s.files.map(f => ({
      ...f,
      path: createFile(f.name, f.size),
    }));

    const memBefore = await getMemory();
    let result;

    try {
      if (s.type === 'single') {
        const f = createdFiles[0];
        result = await singleUpload(testPath, f.path, f.name);

        const uploadType = result.data.uploadType || '-';
        const chunks = result.data.chunks || '-';
        const stats = result.data.stats || {};

        console.log(`  Result: ${result.status === 200 ? 'SUCCESS' : 'FAIL ' + result.status}`);
        console.log(`  Duration: ${result.dur}s | Type: ${uploadType} | Chunks: ${chunks}`);
        if (stats.uploadSpeedMBps) console.log(`  Speed: ${stats.uploadSpeedMBps} MB/s | Hash: ${stats.hashSeconds}s`);

        results.push({
          name: s.name,
          files: 1,
          totalSize: formatSize(totalSize),
          status: result.status,
          duration: result.dur + 's',
          uploadType,
          chunks,
          speed: stats.uploadSpeedMBps ? stats.uploadSpeedMBps + ' MB/s' : '-',
        });
      } else {
        result = await multiUpload(testPath, createdFiles);

        const summary = result.data.summary || {};
        const stats = result.data.stats || {};
        const perFile = (result.data.results || []).map(r =>
          `${r.success ? 'OK' : 'FAIL'} ${r.filename} (${r.durationSeconds || '-'}s, ${r.uploadType || '-'})`
        );

        console.log(`  Result: ${result.status === 200 ? 'SUCCESS' : result.status === 207 ? 'PARTIAL' : 'FAIL ' + result.status}`);
        console.log(`  Duration: ${result.dur}s | Success: ${summary.success}/${summary.total}`);
        if (stats.totalWallClockSeconds) console.log(`  Wall: ${stats.totalWallClockSeconds}s | Multer: ${stats.multerReceiveSeconds}s`);
        for (const pf of perFile) console.log(`    ${pf}`);

        results.push({
          name: s.name,
          files: s.files.length,
          totalSize: formatSize(totalSize),
          status: result.status,
          duration: result.dur + 's',
          uploadType: 'multi',
          chunks: '-',
          speed: stats.totalWallClockSeconds > 0
            ? ((totalSize / 1024 / 1024) / stats.totalWallClockSeconds).toFixed(2) + ' MB/s'
            : '-',
        });
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({
        name: s.name,
        files: s.files.length,
        totalSize: formatSize(totalSize),
        status: 'ERR',
        duration: '-',
        uploadType: '-',
        chunks: '-',
        speed: '-',
      });
    }

    const memAfter = await getMemory();
    const memDiff = (parseFloat(memAfter.heapUsedMB) - parseFloat(memBefore.heapUsedMB)).toFixed(2);
    console.log(`  Memory: ${memBefore.heapUsedMB} → ${memAfter.heapUsedMB}MB (${memDiff > 0 ? '+' : ''}${memDiff}MB) | RSS: ${memAfter.rssMB}MB`);

    // 정리
    await cleanup(testPath);

    // 로컬 임시 파일 삭제
    for (const f of createdFiles) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }

  const finalMem = await getMemory();

  // 결과 요약 테이블
  console.log('\n==========================================================');
  console.log('  RESULTS SUMMARY');
  console.log('==========================================================\n');

  // 헤더
  const cols = ['Scenario', 'Files', 'Size', 'Status', 'Time', 'Speed'];
  console.log(`  ${'Scenario'.padEnd(40)} ${'Files'.padEnd(6)} ${'Size'.padEnd(10)} ${'Status'.padEnd(8)} ${'Time'.padEnd(10)} ${'Speed'.padEnd(12)}`);
  console.log(`  ${'─'.repeat(40)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(12)}`);

  for (const r of results) {
    const status = r.status === 200 ? 'OK' : r.status === 207 ? 'PARTIAL' : 'FAIL';
    console.log(`  ${r.name.padEnd(40)} ${String(r.files).padEnd(6)} ${r.totalSize.padEnd(10)} ${status.padEnd(8)} ${r.duration.padEnd(10)} ${r.speed.padEnd(12)}`);
  }

  console.log(`\n  Memory: ${initialMem.heapUsedMB}MB → ${finalMem.heapUsedMB}MB | RSS: ${finalMem.rssMB}MB`);

  const allOk = results.every(r => r.status === 200);
  console.log(`\n  ${allOk ? 'ALL PASSED' : 'SOME FAILED'}`);
  console.log('==========================================================\n');

  // 정리
  fs.rmSync(TEMP, { recursive: true, force: true });

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
