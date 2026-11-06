// Deploy step: a copy of index.html without comments, so the public page source shows the code but none
// of our internal notes. Function names are kept (onclick handlers call them by name). The repo keeps the
// commented original. Usage: npm i html-minifier-terser@7.2.0 && node tools/minify_index.mjs site/index.html <out>
import { minify } from 'html-minifier-terser';
import fs from 'fs';
const [src, out] = process.argv.slice(2);
const html = fs.readFileSync(src, 'utf8');
const r = await minify(html, {
  removeComments: true, collapseWhitespace: true, conservativeCollapse: true,
  minifyCSS: true, keepClosingSlash: true,
  // strip JS comments and whitespace only: no renaming, so global functions called from onclick keep their names
  minifyJS: { compress: false, mangle: false, format: { comments: false } },
});
fs.writeFileSync(out, r);
console.log(src.length, html.length, '->', r.length);
