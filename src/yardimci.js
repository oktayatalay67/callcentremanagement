// =====================================================================
// src/yardimci.js  -  Ortak sabitler ve yardimci islevler (v0.5.0)
// Platformdan bagimsiz. Oturum okuma, hata bicimi, firma tablo adi uretimi.
// =====================================================================
import { getCookie, setCookie } from 'hono/cookie';
import { veritabani } from './db.js';
import { VARSAYILAN_TEKRAR, jetonImzala, jetonDogrula } from './guvenlik.js';

export const SURUM = '0.7.3';
export const COOKIE = 'oturum';
export const OTURUM_SURE_SN = 12 * 3600;

export const FIRMA_KOD_RE = /^[a-z0-9]{1,20}$/;
export const KULLANICI_RE = /^[a-z0-9._@-]{2,60}$/;
export const ROL_KOD_RE = /^[a-z0-9_]{1,30}$/;
export const RENK_RE = /^#[0-9a-fA-F]{6}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().slice(0, 100);
export const metin = (v, en) => String(v == null ? '' : v).trim().slice(0, en);
export const hata = (c, durum, mesaj, kod) =>
  c.json({ durum: 'hata', mesaj, ...(kod ? { hata_kodu: kod } : {}) }, durum);

// Beklenen (kullaniciya gosterilecek) hata
export class HttpHata extends Error {
  constructor(durum, mesaj) { super(mesaj); this.durum = durum; }
}

// Firma tablo adi YALNIZCA dogrulanmis firma kodu + izinli tablo adindan uretilir.
const TABLOLAR = new Set(['roller', 'rol_izinleri', 'yuklemeler', 'musteriler', 'kontaklar', 'atamalar',
  'atama_gecmisi', 'yasakli_liste', 'durumlar', 'secenekler', 'ayarlar', 'icerikler', 'listeler',
  'liste_kayitlari', 'takvim', 'aramalar', 'islem_gunlugu']);
export function T(firmaKod, ad) {
  if (!FIRMA_KOD_RE.test(String(firmaKod)) || firmaKod === 'platform' || !TABLOLAR.has(ad)) {
    throw new Error('Gecersiz tablo istegi');
  }
  return 'cc.f_' + firmaKod + '_' + ad;
}

export async function jsonGovde(c) {
  try {
    const g = await c.req.json();
    return g && typeof g === 'object' && !Array.isArray(g) ? g : null;
  } catch (e) {
    return null;
  }
}
export function httpsMi(c) {
  try {
    return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
  } catch (e) {
    return false;
  }
}
export function istemciIp(c) {
  return (c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || '').slice(0, 64) || null;
}
export function tekrarSayisi(c) {
  const n = parseInt(c.env && c.env.SIFRE_TEKRAR, 10);
  return n >= 1000 ? n : VARSAYILAN_TEKRAR;
}
export function oturumAnahtari(c) {
  const a = c.env && c.env.OTURUM_ANAHTARI;
  return typeof a === 'string' && a.length >= 32 ? a : null;
}

// Gecerli oturumun kullanicisini DB'den okur; her istekte aktiflik ve oturum surumu kontrol edilir.
export async function oturumAl(c) {
  const anahtar = oturumAnahtari(c);
  if (!anahtar) return null;
  const jeton = getCookie(c, COOKIE);
  if (!jeton) return null;
  const yuk = await jetonDogrula(jeton, anahtar);
  if (!yuk || !yuk.u) return null;
  const r = await veritabani(c.env.DATABASE_URL).sorgu(
    `SELECT u.id, u.kullanici_adi, u.ad_soyad, u.rol_kod, u.firma_id, u.aktif, u.oturum_surumu,
            f.kod AS firma_kod, f.unvan AS firma_unvan, f.durum AS firma_durum
       FROM cc.kullanicilar u LEFT JOIN cc.firmalar f ON f.id = u.firma_id
      WHERE u.id = $1`, [yuk.u]);
  const k = r.rows[0];
  if (!k || !k.aktif || k.oturum_surumu !== yuk.v) return null;
  if (k.firma_id && k.firma_durum !== 'aktif') return null;
  return k;
}

export async function oturumBaslat(c, kullaniciId, surum) {
  const jeton = await jetonImzala(
    { u: kullaniciId, v: surum, e: Math.floor(Date.now() / 1000) + OTURUM_SURE_SN }, oturumAnahtari(c));
  setCookie(c, COOKIE, jeton, {
    httpOnly: true, secure: httpsMi(c), sameSite: 'Strict', path: '/', maxAge: OTURUM_SURE_SN,
  });
}

// Beyaz yaziyla kontrast orani (WCAG): 4.5 ve ustu okunabilir sayilir.
export function kontrastBeyaz(hex) {
  const kanal = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * kanal[0] + 0.7152 * kanal[1] + 0.0722 * kanal[2];
  return 1.05 / (L + 0.05);
}
