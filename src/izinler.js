// =====================================================================
// src/izinler.js  -  Izin katalogu ve izin yukleme (v0.5.0)
// Roller ve izin DEGERLERI firmanin kendi tablosunda (f_<kod>_roller,
// f_<kod>_rol_izinleri) durur; kodda sabit rol listesi YOKTUR.
// Burada yalnizca "hangi izin anahtarlari var" katalogu bulunur.
// ---------------------------------------------------------------------
import { T } from './yardimci.js';

export const KATALOG = {
  kapsam: [
    { k: 'musteri', etiket: 'Müşteriler' },
    { k: 'arama', etiket: 'Aramalar' },
    { k: 'takvim', etiket: 'Takvim' },
    { k: 'rapor', etiket: 'Raporlar' },
  ],
  eylem: [
    { k: 'arama_yap', etiket: 'Arama yap' },
    { k: 'arama_kapat', etiket: 'Aramayı tamamla' },
    { k: 'musteri_ekle', etiket: 'Müşteri ekle' },
    { k: 'musteri_duzenle', etiket: 'Müşteri düzenle' },
    { k: 'musteri_sil', etiket: 'Müşteri sil' },
    { k: 'liste_yonet', etiket: 'Arama listelerini yönet' },
    { k: 'liste_sil', etiket: 'Arama listesi sil' },
    { k: 'excel_yukle', etiket: 'Excel ile müşteri yükle' },
    { k: 'excel_aktar', etiket: 'Excel\'e aktar' },
    { k: 'atama_yap', etiket: 'Müşteri ata' },
    { k: 'yasakli_kaldir', etiket: 'Yasaklı listeden çıkar' },
    { k: 'ayar_yonet', etiket: 'Firma ayarlarını yönet' },
    { k: 'kullanici_yonet', etiket: 'Kullanıcıları yönet' },
    { k: 'rol_yonet', etiket: 'Rolleri ve izinleri yönet' },
    { k: 'firma_profil_duzenle', etiket: 'Firma profilini düzenle' },
    { k: 'rapor_gor', etiket: 'Raporları gör' },
    { k: 'dashboard_gor', etiket: 'Dashboard\'u gör' },
    { k: 'sifre_degistir', etiket: 'Kendi şifresini değiştir' },
  ],
};
// Satiri hic yazilmamis rollerde VARSAYILAN ACIK sayilan izinler (eski roller davranisini korusun)
export const VARSAYILAN_ACIK = ['sifre_degistir'];
export const KAPSAM_DEGERLERI = ['TUM', 'KENDI', ''];
export const KAPSAM_ANAHTARLARI = new Set(KATALOG.kapsam.map((x) => x.k));
export const EYLEM_ANAHTARLARI = new Set(KATALOG.eylem.map((x) => x.k));

// Bir rolun izinlerini okur: { kapsam: {musteri:'TUM',...}, eylem: Set([...]) }
// Pasif rolun izni yoktur.
export async function izinleriYukle(q, firmaKod, rolKod) {
  const r = await q(
    `SELECT i.perm_tip, i.perm_key, i.deger
       FROM ${T(firmaKod, 'rol_izinleri')} i JOIN ${T(firmaKod, 'roller')} r ON r.kod = i.rol_kod
      WHERE i.rol_kod = $1 AND r.aktif`, [rolKod]);
  const kapsam = {};
  const eylem = new Set();
  const gorulen = new Set();
  for (const s of r.rows) {
    if (s.perm_tip === 'scope') kapsam[s.perm_key] = s.deger;
    else if (s.perm_tip === 'action') { gorulen.add(s.perm_key); if (s.deger === '1') eylem.add(s.perm_key); }
  }
  if (r.rows.length) for (const a of VARSAYILAN_ACIK) if (!gorulen.has(a)) eylem.add(a);
  return { kapsam, eylem };
}
