// Собирает все русские строки из src (литералы с кириллицей) — ключи словаря en.ts.
// Запуск: node scripts/extract-strings.mjs [--missing]
//   --missing — только строки без английского перевода (код выхода 1, если такие есть).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..', 'src');
const cyrillic = /[А-Яа-яЁё]/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__') walk(p, out);
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !p.endsWith(path.join('i18n', 'en.ts'))) out.push(p);
  }
  return out;
}

const found = new Map();
for (const file of walk(root)) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    let text;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text.trim();
    if (text && cyrillic.test(text)) {
      // пропускаем регулярные выражения в строках и ключи объектов
      const parent = node.parent;
      const isKey = parent && ts.isPropertyAssignment(parent) && parent.name === node;
      // массивы с суффиксом _RU (названия месяцев) — только для русского интерфейса
      const ruOnly = parent && ts.isArrayLiteralExpression(parent) && ts.isVariableDeclaration(parent.parent) && /_RU$/.test(parent.parent.name.getText());
      if (!isKey && !ruOnly) {
        const rel = path.relative(root, file);
        if (!found.has(text)) found.set(text, new Set());
        found.get(text).add(rel);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

const missingOnly = process.argv.includes('--missing');
let dict = {};
if (missingOnly) {
  const enSrc = fs.readFileSync(path.join(root, 'i18n', 'en.ts'), 'utf8');
  const sf = ts.createSourceFile('en.ts', enSrc, ts.ScriptTarget.Latest, true);
  sf.forEachChild(function find(n) {
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) if (ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))) dict[p.name.text] = true;
    } else ts.forEachChild(n, find);
  });
}
const keys = [...found.keys()].filter((k) => !missingOnly || !dict[k]).sort();
process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((k) => [k, [...found.get(k)].join(', ')])), null, 1) + '\n');
if (missingOnly && keys.length) {
  process.stderr.write(`Без перевода: ${keys.length}\n`);
  process.exitCode = 1;
}
