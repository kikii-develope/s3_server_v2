"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logCorsConfig = exports.corsOptions = void 0;
/**
 * 환경별 CORS origin 설정
 * @returns CORS origin 설정값
 */
const getCorsOrigin = () => {
    const nodeEnv = process.env.NODE_ENV;
    // 개발 환경: 모든 origin 허용 (개발 편의성)
    if (nodeEnv === 'development') {
        console.log('[CORS] Development mode: All origins allowed');
        return true;
    }
    // 환경 변수에서 허용 도메인 가져오기
    const corsOrigins = process.env.CORS_ORIGINS;
    if (corsOrigins) {
        const allowedOrigins = corsOrigins.split(',').map(origin => origin.trim());
        console.log(`[CORS] Allowed origins:`, allowedOrigins);
        return allowedOrigins;
    }
    // CORS_ORIGINS가 설정되지 않은 경우 경고
    console.warn('[CORS] Warning: CORS_ORIGINS not set. No origins will be allowed.');
    return [];
};
/**
 * CORS 설정 옵션
 */
exports.corsOptions = {
    // 허용할 origin
    origin: getCorsOrigin(),
    // 인증 정보(쿠키, Authorization 헤더 등) 포함 허용
    credentials: process.env.CORS_CREDENTIALS === 'true',
    // 허용할 HTTP 메서드
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    // 허용할 헤더
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'If-Match',
        'If-None-Match',
        'Cache-Control'
    ],
    // 노출할 헤더 (클라이언트에서 접근 가능한 헤더)
    exposedHeaders: [
        'Content-Length',
        'Content-Type',
        'ETag',
        'Last-Modified'
    ],
    // preflight 요청 캐시 시간 (초)
    maxAge: 86400, // 24시간
    // OPTIONS 요청에 대한 성공 상태 코드
    optionsSuccessStatus: 200
};
/**
 * CORS 설정 정보 출력
 */
const logCorsConfig = () => {
    console.log('\n=== CORS Configuration ===');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Credentials:', exports.corsOptions.credentials);
    console.log('Methods:', exports.corsOptions.methods);
    console.log('Max Age:', exports.corsOptions.maxAge);
    console.log('========================\n');
};
exports.logCorsConfig = logCorsConfig;
