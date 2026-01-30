"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testConnection = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
/**
 * DB 연결 테스트
 */
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('DB 연결 성공');
        connection.release();
        return true;
    }
    catch (error) {
        console.error('DB 연결 실패:', error.message);
        return false;
    }
};
exports.testConnection = testConnection;
exports.default = pool;
