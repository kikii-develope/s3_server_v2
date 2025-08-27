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