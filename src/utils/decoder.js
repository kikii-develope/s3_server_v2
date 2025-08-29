import iconv from 'iconv-lite';
import jschardet from 'jschardet';

export const decodePathTwiceToNFC = (rawPath) => {
    // path segment 단위로 처리 (../ 등 주의)
    return rawPath
        .split('/').map(seg => {
            if (!seg) return seg;
            // 1차: %25EA.. -> %EA..
            const once = decodeURIComponent(seg);
            // 2차: %EA.. -> 한글
            const twice = decodeURIComponent(once);
            // NFC 정규화
            return twice.normalize('NFC');
        })
        .join('/');
}


export const toUtf8 = (buffer, contentTypeHeader) => {
    let charset = "utf-8";

    // 1) Content-Type에서 charset 추출
    if (contentTypeHeader) {
        const match = contentTypeHeader.match(/charset=([^;]+)/i);
        if (match) charset = match[1].toLowerCase();
    }

    // 2) 헤더에 charset이 없거나 ascii/latin1 같은 값이면 jschardet로 감지
    if (!charset || charset === "ascii" || charset === "latin1") {
        const detect = jschardet.detect(buffer);
        if (detect && detect.encoding) {
            charset = detect.encoding.toLowerCase();
        }
    }

    // 3) iconv-lite로 UTF-8 변환
    if (!iconv.encodingExists(charset)) {
        charset = "utf-8"; // fallback
    }
    return iconv.decode(buffer, charset);
}

export const toUtf8FromFile = (file) => {
    return toUtf8(file.buffer, file.contentType);
}