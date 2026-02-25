/**
 * k6 Load Test for WebDAV Upload/Download Server
 *
 * Usage:
 *   k6 run -e BASE_URL=http://localhost:8000 -e UPLOAD_PATH=test-k6 load_test.js
 *
 * Install k6:
 *   brew install k6        (macOS)
 *   apt install k6          (Ubuntu)
 *   https://k6.io/docs/get-started/installation/
 *
 * Scenarios:
 *   1. single_upload   — 3 VUs for 30s
 *   2. multi_upload    — 2 VUs for 30s (starts at 35s)
 *   3. range_download  — 20 req/s for 20s (starts at 70s)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const UPLOAD_PATH = __ENV.UPLOAD_PATH || 'test-k6';

// Custom metrics
const uploadDuration = new Trend('upload_duration_ms', true);
const uploadFailRate = new Rate('upload_fail_rate');
const downloadDuration = new Trend('download_duration_ms', true);
const download206Count = new Counter('download_206_count');

// Load 1MB test file (path relative to this script)
const testFileData = open('../test_files/test_1mb.bin', 'b');

export const options = {
  scenarios: {
    single_upload: {
      executor: 'constant-vus',
      vus: 3,
      duration: '30s',
      exec: 'singleUpload',
      tags: { scenario: 'single_upload' },
    },
    multi_upload: {
      executor: 'constant-vus',
      vus: 2,
      duration: '30s',
      startTime: '35s',
      exec: 'multiUpload',
      tags: { scenario: 'multi_upload' },
    },
    range_download: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 10,
      startTime: '70s',
      exec: 'rangeDownload',
      tags: { scenario: 'range_download' },
    },
  },
  thresholds: {
    upload_fail_rate: ['rate<0.1'],                                      // < 10% failure
    'upload_duration_ms{scenario:single_upload}': ['p(95)<15000'],       // p95 < 15s
    'http_req_duration{scenario:range_download}': ['p(95)<3000'],        // p95 < 3s
  },
};

// Shared: track an uploaded file for range download
let _uploadedFilePath = null;

/**
 * Scenario 1: Single file upload
 */
export function singleUpload() {
  const fname = `k6_s_${__VU}_${__ITER}_${Date.now()}.bin`;

  const res = http.post(`${BASE_URL}/webdav/upload`, {
    path: UPLOAD_PATH,
    filename: fname,
    file: http.file(testFileData, 'test.bin', 'application/octet-stream'),
  });

  uploadDuration.add(res.timings.duration);

  const passed = check(res, {
    'upload status 200': (r) => r.status === 200,
    'upload has etag':   (r) => {
      try { return r.json('data.etag') !== undefined; } catch { return false; }
    },
  });
  uploadFailRate.add(!passed);

  // Store one filename for range download
  if (res.status === 200 && !_uploadedFilePath) {
    try {
      _uploadedFilePath = `${UPLOAD_PATH}/${res.json('data.filename')}`;
    } catch { /* ignore */ }
  }

  sleep(0.5);
}

/**
 * Scenario 2: Multi-upload (simulate with sequential singles — k6 limitation)
 */
export function multiUpload() {
  const names = [
    `k6_m_a_${__VU}_${__ITER}.bin`,
    `k6_m_b_${__VU}_${__ITER}.bin`,
  ];

  for (const fname of names) {
    const res = http.post(`${BASE_URL}/webdav/upload`, {
      path: UPLOAD_PATH,
      filename: fname,
      file: http.file(testFileData, 'test.bin', 'application/octet-stream'),
    });

    uploadDuration.add(res.timings.duration);
    const passed = check(res, {
      'multi upload 200': (r) => r.status === 200,
    });
    uploadFailRate.add(!passed);
  }

  sleep(1);
}

/**
 * Scenario 3: Range download with random byte ranges
 */
export function rangeDownload() {
  // Ensure we have a file to download
  if (!_uploadedFilePath) {
    const res = http.post(`${BASE_URL}/webdav/upload`, {
      path: UPLOAD_PATH,
      filename: 'k6_dl_target.bin',
      file: http.file(testFileData, 'test.bin', 'application/octet-stream'),
    });
    if (res.status === 200) {
      _uploadedFilePath = `${UPLOAD_PATH}/k6_dl_target.bin`;
    } else {
      return; // skip this iteration
    }
  }

  const fileSize = 1048576; // 1MB test file
  const start = Math.floor(Math.random() * (fileSize - 1024));
  const end = Math.min(start + Math.floor(Math.random() * 51200) + 1024, fileSize - 1);

  const res = http.get(`${BASE_URL}/webdav/download/${_uploadedFilePath}`, {
    headers: { Range: `bytes=${start}-${end}` },
  });

  downloadDuration.add(res.timings.duration);

  const passed = check(res, {
    'range 206':           (r) => r.status === 206,
    'has Content-Range':   (r) => r.headers['Content-Range'] !== undefined,
  });

  if (res.status === 206) {
    download206Count.add(1);
  }
}

/**
 * Teardown: cleanup uploaded files
 */
export function teardown() {
  http.del(`${BASE_URL}/webdav/directory/${UPLOAD_PATH}?force=true`);
}
