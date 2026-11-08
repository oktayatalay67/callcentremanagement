// =====================================================================
// src/db.js  -  Veri katmani (v0.4.0)
// ---------------------------------------------------------------------
// Uygulamanin veritabanina eristigi TEK yer. Platforma ozgu hicbir sey yok:
// standart "pg" surucusu + DATABASE_URL (duz Postgres baglanti dizesi).
//   sorgu(metin, par)    : tek sorgu, kendi baglantisini acip kapatir
//   baglanti(async q=>{}): bir baglanti uzerinde birden cok sorgu (islem YOK)
//   islem(async q=>{})   : ayni baglantida BEGIN/COMMIT (hata olursa geri alinir)
// =====================================================================
import pg from 'pg';

function istemciOlustur(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    const e = new Error('DATABASE_URL tanimli degil');
    e.code = 'DATABASE_URL_YOK';
    throw e;
  }
  return new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
  });
}

export function veritabani(databaseUrl) {
  async function calistir(fn, islemli) {
    const istemci = istemciOlustur(databaseUrl);
    await istemci.connect();
    const q = (metin, parametreler = []) => istemci.query(metin, parametreler);
    try {
      if (islemli) await istemci.query('BEGIN');
      const sonuc = await fn(q);
      if (islemli) await istemci.query('COMMIT');
      return sonuc;
    } catch (e) {
      if (islemli) await istemci.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      await istemci.end().catch(() => {});
    }
  }
  return {
    sorgu: (metin, parametreler = []) => calistir((q) => q(metin, parametreler), false),
    baglanti: (fn) => calistir(fn, false),
    islem: (fn) => calistir(fn, true),
  };
}
