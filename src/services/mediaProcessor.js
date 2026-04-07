/**
 * src/services/mediaProcessor.js
 * 이미지(sharp) / 영상(ffmpeg) 변환
 * - 출력 경로: UUID 기반 고유 (충돌 방지)
 * - 영상: 10분 timeout + SIGKILL
 * - console 미사용
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';

const TEMP_DIR = process.env.TEMP_DIR || '/tmp/upload-temp';

// TEMP_DIR 존재 보장
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * UUID 기반 고유 출력 경로 생성 — 동시 요청에도 절대 충돌 없음
 */
const uniqueOutputPath = (ext) => {
    return path.join(TEMP_DIR, `${Date.now()}-${crypto.randomUUID()}.${ext}`);
};

/**
 * MIME 타입으로 파일 종류 판별
 */
const VIDEO_EXT_HINTS = new Set(['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm']);
const IMAGE_EXT_HINTS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'gif']);

export const isImage = (mimeType, ext = '') =>
    String(mimeType).startsWith('image/') || IMAGE_EXT_HINTS.has(String(ext).toLowerCase());

export const isVideo = (mimeType, ext = '') =>
    String(mimeType).startsWith('video/') || VIDEO_EXT_HINTS.has(String(ext).toLowerCase());

/**
 * 이미지 변환 (sharp, 동기 방식)
 * @returns {{ outputPath, format }}
 */
export const processImage = async (inputPath, options = {}) => {
    const format = options.format || process.env.IMAGE_OUTPUT_FORMAT || 'webp';
    const quality = parseInt(process.env.IMAGE_QUALITY) || 80;
    const outputPath = uniqueOutputPath(format);

    await sharp(inputPath)
        .toFormat(format, { quality })
        .toFile(outputPath);

    return { outputPath, format };
};

/**
 * 영상 변환 (ffmpeg, 비동기 방식)
 * - 10분 시간 초과 시 SIGKILL 후 에러
 * @returns {{ outputPath, format }}
 */
export const processVideo = (inputPath, options = {}) => {
    const format = options.format || process.env.VIDEO_OUTPUT_FORMAT || 'mp4';
    const codec = options.codec || process.env.VIDEO_CODEC || 'libx264';
    const crf = String(options.crf || process.env.VIDEO_CRF || '23');
    const timeoutSec = parseInt(process.env.FFMPEG_TIMEOUT) || 600;
    const outputPath = uniqueOutputPath(format);

    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err) => { if (!settled) { settled = true; reject(err); } };
        const succeed = () => { if (!settled) { settled = true; resolve({ outputPath, format }); } };

        const command = ffmpeg(inputPath)
            .output(outputPath)
            .videoCodec(codec)
            .addOption('-crf', crf)
            .on('end', succeed)
            .on('error', fail);

        command.run();

        // 타임아웃: ffmpeg 무한 실행 방지
        const timer = setTimeout(() => {
            try { command.kill('SIGKILL'); } catch { }
            fail(new Error(`ffmpeg timeout: ${timeoutSec}초 초과`));
        }, timeoutSec * 1000);

        // 완료/실패 시 타이머 제거
        command.on('end', () => clearTimeout(timer));
        command.on('error', () => clearTimeout(timer));
    });
};
