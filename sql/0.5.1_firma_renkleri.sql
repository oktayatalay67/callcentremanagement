-- =====================================================================
-- SQL 0.5.1  -  Firma renkleri (opsiyonel)
-- Ne yapar: cc.firmalar tablosuna renk_ana ve renk_vurgu kolonlarini ekler
--           (bos = platformun varsayilan rengi), gecerli renk bicimini zorlar
--           ve InspireIT icin marka renklerini yazar.
-- Tekrar calistirilabilir. Mevcut veriyi silmez.
-- =====================================================================
BEGIN;

ALTER TABLE cc.firmalar ADD COLUMN IF NOT EXISTS renk_ana   text;
ALTER TABLE cc.firmalar ADD COLUMN IF NOT EXISTS renk_vurgu text;

ALTER TABLE cc.firmalar DROP CONSTRAINT IF EXISTS firmalar_renk_chk;
ALTER TABLE cc.firmalar ADD CONSTRAINT firmalar_renk_chk CHECK (
  (renk_ana   IS NULL OR renk_ana   ~ '^#[0-9A-F]{6}$') AND
  (renk_vurgu IS NULL OR renk_vurgu ~ '^#[0-9A-F]{6}$'));

-- InspireIT marka renkleri: Birincil Lacivert ve Vurgu Pembe
UPDATE cc.firmalar SET renk_ana = '#2A4B9B', renk_vurgu = '#E33279' WHERE kod = 'inspireit';

COMMIT;

-- Dogrulama (beklenen: inspireit satirinda #2A4B9B ve #E33279, digerlerinde bos)
SELECT kod, renk_ana, renk_vurgu FROM cc.firmalar ORDER BY kod;
