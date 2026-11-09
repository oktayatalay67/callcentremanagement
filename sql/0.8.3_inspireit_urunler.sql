-- v0.8.3: InspireIT firmasi icin urun / hizmet secenekleri (inspireit.com.tr kataloguna gore). Tekrar calistirilabilir.
INSERT INTO cc.f_inspireit_secenekler (tur, kod, etiket, sira) VALUES
  ('urun_hizmet', 'monistream',        'MoniStream',                                  10),
  ('urun_hizmet', 'datasafe',          'DataSafe',                                    20),
  ('urun_hizmet', 'inspireai_cc',      'InspireAI Call Center',                       30),
  ('urun_hizmet', 'inspireai_dq',      'InspireAI Data Query',                        40),
  ('urun_hizmet', 'inspireai_dm',      'InspireAI Data Masking',                      50),
  ('urun_hizmet', 'yonetilen_bt',      'Yönetilen BT Hizmetleri (Veritabanı, Sistem, Bulut)', 60),
  ('urun_hizmet', 'vt_modernizasyon',  'Veritabanı Altyapı Modernizasyonu',           70),
  ('urun_hizmet', 'bulut_donusum',     'Bulut Dönüşüm Hizmetleri',                    80),
  ('urun_hizmet', 'yapay_zeka',        'Yapay Zekâ Hizmetleri (Generative AI)',       90),
  ('urun_hizmet', 'bi_dwh',            'İş Zekâsı ve Veri Ambarı Hizmetleri',        100),
  ('urun_hizmet', 'dis_kaynak',        'Dış Kaynak ve Uzman BT Personel Sağlama',    110)
ON CONFLICT (tur, kod) DO NOTHING;
SELECT kod, etiket FROM cc.f_inspireit_secenekler WHERE tur = 'urun_hizmet' ORDER BY sira;
