// src/istemci/*.js dosyalarini src/istemci.gen.js icine gomer. Calistir: npm run istemci
import { readFileSync, writeFileSync } from 'node:fs';
const surum = JSON.parse(readFileSync('package.json', 'utf8')).version;
const oku = (ad) => readFileSync('src/istemci/' + ad, 'utf8').replace(/__SURUM__/g, surum);
const app = oku('ortak.js') + '\n' + oku('uygulama.js') + '\n' + oku('musteri.js') + '\n' + oku('arama.js');
const kurulum = oku('ortak.js') + '\n' + oku('kurulum.js');
writeFileSync('src/istemci.gen.js',
  '// OTOMATIK URETILDI (npm run istemci) - elle DEGISTIRME. Kaynak: src/istemci/*.js\n' +
  'export const APP_JS = ' + JSON.stringify(app) + ';\n' +
  'export const KURULUM_JS = ' + JSON.stringify(kurulum) + ';\n' +
  'export const XLSX_JS = ' + JSON.stringify(readFileSync('vendor/xlsx.core.min.js', 'utf8')) + ';\n');
console.log('istemci.gen.js uretildi, surum', surum);
