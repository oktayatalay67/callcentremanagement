// =====================================================================
// src/guvenlik.js  -  Sifre ozeti ve imzali oturum jetonu (v0.4.0)
// ---------------------------------------------------------------------
// Yalnizca Web Crypto (globalThis.crypto.subtle) kullanir: Node 20+,
// Cloudflare Workers, Deno ve Bun'da ayni sekilde calisir. Dis bagimlilik yok.
// ---------------------------------------------------------------------
const enc = new TextEncoder();

export const VARSAYILAN_TEKRAR = 100000; // PBKDF2 tekrar sayisi (ozetin icinde saklanir)

function b64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uCoz(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const d = atob(s);
  const b = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i);
  return b;
}
function sabitZamanliEsit(a, b) {
  if (a.length !== b.length) return false;
  let f = 0;
  for (let i = 0; i < a.length; i++) f |= a[i] ^ b[i];
  return f === 0;
}

async function pbkdf2(sifre, tuz, tekrar) {
  const anahtar = await crypto.subtle.importKey('raw', enc.encode(sifre), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: tuz, iterations: tekrar }, anahtar, 256));
}

// Bicim: pbkdf2-sha256$<tekrar>$<tuz>$<ozet>
export async function sifreOzeti(sifre, tekrar = VARSAYILAN_TEKRAR) {
  const tuz = crypto.getRandomValues(new Uint8Array(16));
  const ozet = await pbkdf2(sifre, tuz, tekrar);
  return 'pbkdf2-sha256$' + tekrar + '$' + b64u(tuz) + '$' + b64u(ozet);
}

export async function sifreDogrula(sifre, kayitli) {
  try {
    const p = String(kayitli || '').split('$');
    if (p.length !== 4 || p[0] !== 'pbkdf2-sha256') return false;
    const tekrar = parseInt(p[1], 10);
    if (!(tekrar >= 1000 && tekrar <= 5000000)) return false;
    const beklenen = b64uCoz(p[3]);
    const hesap = await pbkdf2(sifre, b64uCoz(p[2]), tekrar);
    return sabitZamanliEsit(hesap, beklenen);
  } catch (e) {
    return false;
  }
}

// Kullanici yokken de ayni sureyi harcamak icin (kullanici adi tahminini zorlastirir)
export const SAHTE_OZET = 'pbkdf2-sha256$' + VARSAYILAN_TEKRAR +
  '$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function hmacAnahtari(anahtar) {
  return crypto.subtle.importKey('raw', enc.encode(anahtar),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Jeton: <govde>.<imza>   govde = base64url(JSON), imza = HMAC-SHA256
export async function jetonImzala(yuk, anahtar) {
  const govde = b64u(enc.encode(JSON.stringify(yuk)));
  const imza = await crypto.subtle.sign('HMAC', await hmacAnahtari(anahtar), enc.encode(govde));
  return govde + '.' + b64u(imza);
}

export async function jetonDogrula(jeton, anahtar) {
  try {
    const p = String(jeton || '').split('.');
    if (p.length !== 2) return null;
    const gecerli = await crypto.subtle.verify('HMAC', await hmacAnahtari(anahtar), b64uCoz(p[1]), enc.encode(p[0]));
    if (!gecerli) return null;
    const yuk = JSON.parse(new TextDecoder().decode(b64uCoz(p[0])));
    if (!yuk || typeof yuk.e !== 'number' || yuk.e < Math.floor(Date.now() / 1000)) return null;
    return yuk;
  } catch (e) {
    return null;
  }
}

// Gizli anahtar karsilastirmasi (sabit zamanli): once ozetle, sonra karsilastir
export async function anahtarEsitMi(a, b) {
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(a))));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(b))));
  return sabitZamanliEsit(ha, hb);
}
