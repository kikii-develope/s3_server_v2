import iconv from 'iconv-lite';
import jschardet from 'jschardet';

export const decodePathTwiceToNFC = (rawPath) => {
    return decodePathTwice(rawPath, 'NFC');
}

export const decodePathTwiceToNFD = (rawPath) => {
    return decodePathTwice(rawPath, 'NFD');
}

export const decodePathTwiceToNFKC = (rawPath) => {
    return decodePathTwice(rawPath, 'NFKC');
}

export const decodePathTwiceToNFKD = (rawPath) => {
    return decodePathTwice(rawPath, 'NFKD');
}


export const decodePathTwice = (rawPath, decodeType = 'NFC') => {
    // path segment 단위로 처리 (../ 등 주의)
    return rawPath
        .split('/').map(seg => {
            if (!seg) return seg;
            // 1차: %25EA.. -> %EA..
            const once = decodeURIComponent(seg);
            // 2차: %EA.. -> 한글
            const twice = decodeURIComponent(once);
            // NFC 정규화
            return twice.normalize(decodeType);
        })
        .join('/');
}
