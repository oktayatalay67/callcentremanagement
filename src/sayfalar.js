// =====================================================================
// src/sayfalar.js  -  HTML iskeleti ve stiller (v0.5.0)
// Istemci kodu src/istemci/*.js dosyalarinda yazilir, "npm run istemci" ile
// src/istemci.gen.js'e gomulur. CSP satir ici betige izin vermedigi icin
// betikler /app.js ve /kurulum.js olarak ayri sunulur.
// =====================================================================
const STIL = `
:root{--ana:#2f6fdb;--vurgu:#dde3ea}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f3f5f8;color:#1c2430;font-size:14px}
main{max-width:420px;margin:8vh auto;padding:0 16px}
main.genis{max-width:none;margin:0;padding:0}
.kart{background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:28px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.alt{color:#5c6b7d;font-size:13px;margin:0 0 20px}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 4px}
input,select,textarea{width:100%;padding:9px 11px;font-size:14px;border:1px solid #b9c4d0;border-radius:6px;background:#fff;font-family:inherit}
input[type=checkbox]{width:auto}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ana);border-color:var(--ana)}
input:disabled,select:disabled{background:#eef1f5;color:#5c6b7d}
button{padding:9px 14px;font-size:14px;font-weight:600;color:#fff;background:var(--ana);border:0;border-radius:6px;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
button.tam{width:100%;margin-top:20px;padding:11px;font-size:15px}
button.ikincil{background:#fff;color:var(--ana);border:1px solid var(--ana)}
button.tehlike{background:#b42318}
button.kucuk{padding:5px 9px;font-size:12px}
.hata{margin-top:14px;padding:10px 12px;background:#fdecea;color:#8a1c14;border-radius:6px;font-size:14px}
.basari{margin-top:14px;padding:10px 12px;background:#e6f4ea;color:#14532d;border-radius:6px;font-size:14px}
dl{margin:16px 0 0;font-size:14px}dt{color:#5c6b7d;font-size:12px;margin-top:10px}dd{margin:2px 0 0;font-weight:600}
.surum{text-align:center;color:#8a96a5;font-size:12px;margin-top:14px}
a{color:var(--ana)}
/* uygulama kabugu */
.ust{display:flex;align-items:center;gap:14px;background:#fff;border-bottom:3px solid var(--vurgu);padding:10px 20px;height:58px}
.ust .logo{height:36px;max-width:140px;object-fit:contain}
.ust .firma{font-weight:700;font-size:16px}
.ust .bosluk{flex:1}
.ust .kisi{color:#5c6b7d;font-size:13px}
.govde{display:flex;min-height:calc(100vh - 58px)}
.menu{width:210px;background:#fff;border-right:1px solid #dde3ea;padding:14px 10px}
.menu a{display:block;padding:9px 12px;margin-bottom:2px;border-radius:6px;color:#1c2430;text-decoration:none;font-weight:600}
.menu a:hover{background:color-mix(in srgb, var(--ana) 9%, #fff)}
.menu a.aktif{background:var(--ana);color:#fff}
.icerik{flex:1;padding:24px;min-width:0}
.kutular{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;max-width:960px}
.kutu{flex:1;min-width:120px;background:#fff;color:#1c2430;border:2px solid #dde3ea;border-radius:10px;padding:12px;font-weight:600}
.kutu.aktif{border-color:var(--ana);background:color-mix(in srgb, var(--ana) 9%, #fff)}.kutu .sayi{font-size:26px;font-weight:700;color:var(--ana)}
.kayit{display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:12px 14px;margin-bottom:8px;max-width:960px}
.kayit.yasak{border-color:#b42318;background:#fdf3f2}
.bant{margin-top:6px;padding:4px 8px;background:#b42318;color:#fff;border-radius:6px;font-size:12px;font-weight:600;display:inline-block}
.modal-arka{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;z-index:50}
.modal{background:#fff;border-radius:12px;padding:20px;width:100%;max-width:760px}
.telkutu{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0;padding:12px;background:#f4f6f9;border-radius:8px}
.dugme-link{display:inline-block;padding:8px 14px;background:var(--ana);color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px}
.soru{margin:14px 0;padding:12px;border:1px solid #dde3ea;border-radius:8px}
.secenekler{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
button.sec{background:#fff;color:#1c2430;border:1px solid #c5ced9}button.sec.aktif{background:var(--ana);color:#fff;border-color:var(--ana)}
.metin{white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e9ef;border-radius:6px;padding:10px;margin:6px 0;font-size:14px}
label.onay{display:inline-flex;align-items:center;gap:4px;font-weight:400;margin-right:12px}
.icerik-kutu{border:1px solid #e5e9ef;border-radius:8px;padding:10px;margin:8px 0}
.kisiler{display:flex;flex-direction:column;gap:6px}
.kisi{border:1px solid #dde3ea;border-radius:8px;padding:8px 10px;cursor:pointer;background:#fff}
.kisi.secili{border-color:var(--ana);background:color-mix(in srgb, var(--ana) 7%, #fff)}
.kisi.yasak{border-color:#b42318;background:#fdf3f2;cursor:not-allowed}
.kisi .isaret{color:var(--ana);font-size:16px;width:16px}
.panel{background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:20px;margin-bottom:18px;max-width:960px}
.izgara{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.satir{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#5c6b7d;font-size:12px;font-weight:600;padding:8px;border-bottom:1px solid #dde3ea}
td{padding:9px 8px;border-bottom:1px solid #eef1f5;vertical-align:middle}
tr.pasif td{color:#8a96a5}
.rozet{display:inline-block;padding:2px 8px;border-radius:10px;background:#eef1f5;font-size:12px;font-weight:600}
.rozet.yesil{background:#e6f4ea;color:#14532d}.rozet.gri{background:#eef1f5;color:#5c6b7d}
.iki{display:grid;grid-template-columns:240px 1fr;gap:18px;max-width:1100px}
.rol{padding:10px 12px;border:1px solid #dde3ea;border-radius:8px;margin-bottom:8px;cursor:pointer;background:#fff}
.rol.secili{border-color:var(--ana);background:color-mix(in srgb, var(--ana) 9%, #fff)}
.izin{display:flex;align-items:center;gap:8px;padding:5px 0}
.izin input{margin:0}.izin label{margin:0;font-weight:400}
.logokutu{display:flex;align-items:center;gap:16px;margin:8px 0}
.renk{display:flex;align-items:center;gap:12px;margin:10px 0;flex-wrap:wrap}.renk input[type=color]{width:46px;height:34px;padding:2px;cursor:pointer}.renk .ad{min-width:120px;font-weight:600}
.logokutu img{max-height:64px;max-width:200px;border:1px solid #dde3ea;border-radius:6px;padding:4px;background:#fff}
@media(max-width:800px){.izgara,.iki{grid-template-columns:1fr}.menu{width:150px}}
`;

function sayfa(baslik, betik) {
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + baslik + '</title><style>' + STIL + '</style></head>' +
    '<body><main id="kok"></main><script src="' + betik + '"></script></body></html>';
}

export const girisSayfasi = () => sayfa('Çağrı Merkezi Platformu', '/app.js');
export const kurulumSayfasi = () => sayfa('Platform Kurulumu', '/kurulum.js');
