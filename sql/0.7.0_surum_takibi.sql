-- =====================================================================
-- SQL 0.7.0  -  Surum takibi
-- Ne yapar: giris kayitlarina ve kullanicilara kullanilan uygulama surumunu ekler.
-- Tekrar calistirilabilir. Mevcut veriyi silmez (eski kayitlarda surum bos kalir).
-- =====================================================================
BEGIN;
ALTER TABLE cc.giris_kayitlari ADD COLUMN IF NOT EXISTS surum text;
ALTER TABLE cc.kullanicilar    ADD COLUMN IF NOT EXISTS son_surum text;
ALTER TABLE cc.kullanicilar    ADD COLUMN IF NOT EXISTS son_gorulme timestamptz;
COMMIT;

-- Dogrulama (beklenen: 3 satir)
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'cc'
   AND ((table_name = 'giris_kayitlari' AND column_name = 'surum')
     OR (table_name = 'kullanicilar' AND column_name IN ('son_surum', 'son_gorulme')))
 ORDER BY 1, 2;
