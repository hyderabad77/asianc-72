import type { Source } from "../types/sources";
const OBF_STRINGS = [
  "9484958e9793bc83869386ca89868a82dac084959e979388c0ba",
  "83869386",
  "d4d4d1ded0d5d7bfae938486bf",
  "d2d5d2ded5d5dfd4d2d1dfd5ded3d5d4",
  "b29381df",
  "808293",
  "d1d6ac8eac80b3a3",
  "d5d0d0d7d2d4dfd7abb585bea0a9",
  "ded3d2dfdfd5ded4d4d0d2d7d2d4d3d4d5d0deded5d5d5d3d3d2d2d5d6d5dfde",
  "d1d5d1d6dfd4d193b186b78fac",
  "958281",
  "d5d5d3d4dfd6d3a68297af9da1",
  "de8f8b94a290a4",
  "9786959482",
  "91868b9282",
  "8b888486938e8889",
  "94828695848f",
  "d4d6d5ded2aaa58ea1b680",
  "949285",
  "d3d2d0d3dfb6bdb6a3979e",
  "828984",
  "d3ded5d4ded1d7909580b68493",
  "d4d2d1b7b292838a8f",
];
const XOR_CONST = 0xe7;
const decodeHexXor = (hex: string) => {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(h => parseInt(h, 16)));
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ XOR_CONST;
  return new TextDecoder().decode(out);
};
const DECODED = OBF_STRINGS.map(decodeHexXor);
const INDEX_BASE = 151;
const ARR_LEN = DECODED.length;
function computeRotationShift(): number {
  for (let s = 0; s < ARR_LEN; s++) {
    const vA6 = DECODED[(0xa6 - INDEX_BASE + s + ARR_LEN) % ARR_LEN];
    const vAD = DECODED[(0xad - INDEX_BASE + s + ARR_LEN) % ARR_LEN];
    const v9F = DECODED[(0x9f - INDEX_BASE + s + ARR_LEN) % ARR_LEN];
    if (vA6 === "enc" && vAD === "Utf8" && v9F === "parse") return s;
  }
  return 0;
}
const ROT_SHIFT = computeRotationShift();
const fromIdx = (hexIndex: number) => {
  const raw = hexIndex - INDEX_BASE;
  const i = (raw + ROT_SHIFT + ARR_LEN) % ARR_LEN;
  return DECODED[i];
};

function getKeyIv() {
  const keyStr = fromIdx(0x9a);
  const ivStr = fromIdx(0xac);
  return { keyStr, ivStr };
}

const asciiToBytes = (s: string) => {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
};
const base64ToBytes = (b64: string) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

function pkcs7Unpad(u8: Uint8Array): Uint8Array {
  if (u8.length === 0) return u8;
  const pad = u8[u8.length - 1]!;
  if (pad < 1 || pad > 16) return u8;
  for (let i = u8.length - pad; i < u8.length; i++) {
    if (u8[i] !== pad) return u8;
  }
  return u8.subarray(0, u8.length - pad);
}

async function aesCbcDecryptBase64(b64: string, keyStr: string, ivStr: string): Promise<string> {
  const cleaned = b64.replace(/[\s\u200b-\u200d\ufeff]+/g, "");
  const keyBytes = asciiToBytes(keyStr);
  const ivBytes = asciiToBytes(ivStr);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC", length: keyBytes.length * 8 },
    false,
    ["decrypt"]
  );
  const cipher = base64ToBytes(cleaned);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, cryptoKey, cipher);
  const u8 = new Uint8Array(plainBuf);
  const unpadded = pkcs7Unpad(u8);
  let text = new TextDecoder().decode(unpadded);
  return text.replace(/\u0000+$/g, "");
}
function pickIframeSrc(html: string): string | null {
  const m1 = html.match(/<iframe[^>]*id=["']embedvideo["'][^>]*src=["']([^"']+)["'][^>]*>/i);
  if (m1) return m1[1];
  const m2 = html.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
  return m2 ? m2[1] : null;
}
function parseScriptDataValue(html: string): string | null {
  const m = html.match(/<script[^>]*src=["']\/?assets\/crypto-js\.js["'][^>]*data-value=["']([^"']+)["'][^>]*>/i);
  return m ? m[1] : null;
}

function parseOgTitle(html: string): string | null {
  const m1 = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["'][^>]*>/i);
  if (m1) return m1[1];
  const m2 = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m2 ? m2[1].trim() : null;
}

export async function extractVidbasic(id: string): Promise<Source> {
  const { keyStr, ivStr } = getKeyIv();
  const embedUrl = `https://vidbasic.top/embed/${encodeURIComponent(id)}`;
  const embedRes = await fetch(embedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://vidbasic.top/",
      "Origin": "https://vidbasic.top",
    },
  });
  const embedHtml = await embedRes.text();
  const ogTitle = parseOgTitle(embedHtml);
  const iframeSrc = pickIframeSrc(embedHtml);
  if (!iframeSrc) throw new Error("embed iframe not found");
  let dataValue: string | null = null;
  try {
    const url = new URL(iframeSrc, "https://vidbasic.top");
    const keyParam = url.searchParams.get("key");
    if (keyParam) {
      dataValue = keyParam;
    }
  } catch {}

  if (!dataValue) {
    const thirdUrl = new URL(iframeSrc, "https://vidbasic.top").toString();
    const thirdRes = await fetch(thirdUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://vidbasic.top/",
        "Origin": "https://vidbasic.top",
      },
    });
    const thirdHtml = await thirdRes.text();
    dataValue = parseScriptDataValue(thirdHtml);
  }
  if (!dataValue) throw new Error("data-value not found");

  const url = await aesCbcDecryptBase64(dataValue, keyStr, ivStr);
  const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes(".m3u8");
  const userAgent = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36';
  const defaultDomain = 'https://vidbasic.top/';
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    Referer: defaultDomain,
    Origin: 'https://vidbasic.top',
  };

  function base64UrlEncodeString(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    const b64 = btoa(binary);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  const sources: { url: string; quality: string }[] = [];
  if (isHls) {
    const payload = { u: url, h: headers };
    const encoded = base64UrlEncodeString(JSON.stringify(payload));
    sources.push({ url: `/hls/${encoded}.m3u8`, quality: 'hls' });
  } else {
    sources.push({ url, quality: 'auto' });
  }

  const data: Source = {
    sources,
    tracks: [],
    audio: [],
    intro: { start: 0, end: 0 },
    outro: { start: 0, end: 0 },
    headers,
  };
  if (ogTitle) {
    data.tracks.push({ url: ogTitle, lang: 'en', label: 'title' });
  }
  return data;
}
