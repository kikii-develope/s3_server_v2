"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodePathTwice = exports.decodePathTwiceToNFKD = exports.decodePathTwiceToNFKC = exports.decodePathTwiceToNFD = exports.decodePathTwiceToNFC = void 0;
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const jschardet_1 = __importDefault(require("jschardet"));
const decodePathTwiceToNFC = (rawPath) => {
    return (0, exports.decodePathTwice)(rawPath, 'NFC');
};
exports.decodePathTwiceToNFC = decodePathTwiceToNFC;
const decodePathTwiceToNFD = (rawPath) => {
    return (0, exports.decodePathTwice)(rawPath, 'NFD');
};
exports.decodePathTwiceToNFD = decodePathTwiceToNFD;
const decodePathTwiceToNFKC = (rawPath) => {
    return (0, exports.decodePathTwice)(rawPath, 'NFKC');
};
exports.decodePathTwiceToNFKC = decodePathTwiceToNFKC;
const decodePathTwiceToNFKD = (rawPath) => {
    return (0, exports.decodePathTwice)(rawPath, 'NFKD');
};
exports.decodePathTwiceToNFKD = decodePathTwiceToNFKD;
const decodePathTwice = (rawPath, decodeType = 'NFC') => {
    // path segment 단위로 처리 (../ 등 주의)
    return rawPath
        .split('/').map(seg => {
        if (!seg)
            return seg;
        // 1차: %25EA.. -> %EA..
        const once = decodeURIComponent(seg);
        // 2차: %EA.. -> 한글
        const twice = decodeURIComponent(once);
        // NFC 정규화
        return twice.normalize(decodeType);
    })
        .join('/');
};
exports.decodePathTwice = decodePathTwice;
