import mysql from 'mysql2/promise';

const pool = mysql.createPool({
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
export const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('DB 연결 성공');
        connection.release();
        return true;
    } catch (error) {
        console.error('DB 연결 실패:', error.message);
        return false;
    }
};

export default pool;
