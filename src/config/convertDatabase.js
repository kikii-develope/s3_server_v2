/**
 * src/config/convertDatabase.js
 * 미디어 변환 테스트 전용 DB 연결 — 기존 database.js와 완전 분리
 * 환경변수: CONVERT_DB_HOST, CONVERT_DB_PORT, CONVERT_DB_USER, CONVERT_DB_PASSWORD, CONVERT_DB_NAME
 */

import mysql from 'mysql2/promise';

const convertPool = mysql.createPool({
    host: process.env.CONVERT_DB_HOST,
    port: parseInt(process.env.CONVERT_DB_PORT) || 3306,
    user: process.env.CONVERT_DB_USER,
    password: process.env.CONVERT_DB_PASSWORD,
    database: process.env.CONVERT_DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: '+09:00',
});

convertPool.on('connection', (connection) => {
    connection.query("SET time_zone = '+09:00'", () => {
        // 세션 타임존 설정 실패 시 기본값 유지
    });
});

export const testConvertConnection = async () => {
    try {
        const conn = await convertPool.getConnection();
        await conn.query("SET time_zone = '+09:00'");
        conn.release();
        return true;
    } catch {
        return false;
    }
};

export default convertPool;
