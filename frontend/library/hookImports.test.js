import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 훅을 **import 없이** 부르면 빌드는 통과하고 그 화면을 실제로 열 때만 터진다
// (ReferenceError: useDateFormat is not defined). 단위 테스트가 렌더하지 않는 컴포넌트라면
// 아무도 못 잡는다 — RecentItems가 실제로 그렇게 새어나갔다.
//
// 그래서 소스에서 use*() 호출을 훑어 "그 파일 안에서 import되었거나 정의된 이름"인지만 본다.
// 프레임워크가 아니라 정적 스캔 한 개다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['components', 'pages', 'hooks', 'library'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (!/\.jsx?$/.test(name) || /\.test\.jsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/** import 구문에서 들여온 이름 + 파일 안에서 선언된 이름. */
function declaredNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    for (const n of clause.matchAll(/\{([\s\S]*?)\}/g)) {
      for (const part of n[1].split(',')) {
        const alias = part.split(/\s+as\s+/).pop().trim();
        if (alias) names.add(alias);
      }
    }
    const bare = clause.replace(/\{[\s\S]*?\}/g, '').replace(/,/g, ' ').trim();
    for (const part of bare.split(/\s+/)) {
      const alias = part.replace(/^\*\s*as\s*/, '').trim();
      if (alias && alias !== 'as' && alias !== '*') names.add(alias);
    }
  }
  for (const m of src.matchAll(/(?:function|const|let|var)\s+(use[A-Z]\w*)/g)) names.add(m[1]);
  return names;
}

/** 주석을 걷어낸 소스 — 설명문에 적힌 useXxx()를 호출로 오인하지 않기 위해서다. */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock.split('\n').map((line) => {
    let quote = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quote) {
        if (c === '\\') { i += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

/** `.useX(` 같은 멤버 호출은 제외하고, 훅처럼 호출되는 식별자만 모은다. */
function usedHooks(src) {
  const used = new Set();
  for (const m of stripComments(src).matchAll(/(^|[^.\w$])(use[A-Z]\w*)\s*\(/g)) used.add(m[2]);
  return used;
}

describe('훅은 쓰기 전에 반드시 import한다', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d)));

  it('스캔 대상 파일이 실제로 있다 (경로 오타로 조용히 통과하지 않게)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('use*() 호출이 모두 import되었거나 그 파일에서 정의된 이름이다', () => {
    const missing = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const declared = declaredNames(src);
      for (const hook of usedHooks(src)) {
        if (!declared.has(hook)) missing.push(`${relative(ROOT, file)}: ${hook}`);
      }
    }
    expect(missing, `import 없이 호출된 훅:\n${missing.join('\n')}`).toEqual([]);
  });
});
