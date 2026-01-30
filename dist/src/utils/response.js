"use strict";
/**
 * 공통 응답 유틸리티
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResponse = exports.successResponse = void 0;
/**
 * 성공 응답
 * @param {Object} res - Express response 객체
 * @param {string} message - 응답 메시지
 * @param {Object} data - 추가 데이터 (선택)
 * @param {number} status - HTTP 상태 코드 (기본값: 200)
 */
const successResponse = (res, message, data = {}, status = 200) => {
    return res.status(status).json({
        message,
        status,
        ...data
    });
};
exports.successResponse = successResponse;
/**
 * 에러 응답
 * @param {Object} res - Express response 객체
 * @param {string} message - 에러 메시지
 * @param {number} status - HTTP 상태 코드 (기본값: 500)
 * @param {Object} data - 추가 데이터 (선택)
 */
const errorResponse = (res, message, status = 500, data = {}) => {
    return res.status(status).json({
        message,
        status,
        ...data
    });
};
exports.errorResponse = errorResponse;
