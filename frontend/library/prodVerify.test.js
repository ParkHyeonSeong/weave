// scripts/prod-verify.sh — 프론트 베이스 이미지만 빌드마다 새로 받고(--pull), 빌드가 실패하면 옮겨진 태그를 실행 중 이미지로 되돌린다.
// 실제 스크립트를 임시 폴더에 복사해 스모크 단계(prod-smoke.sh)만 통과하는 가짜로 두고, compose·docker는 호출을 기록하는 가짜로 돌린다.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runVerify({ failBuild } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'prod-verify-'));
  const exe = (file, lines) => {
    writeFileSync(path.join(dir, file), ['#!/bin/sh', ...lines].join('\n'));
    chmodSync(path.join(dir, file), 0o755);
  };
  try {
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'bin'));
    copyFileSync(path.join(ROOT, 'scripts/prod-verify.sh'), path.join(dir, 'scripts/prod-verify.sh'));
    exe('scripts/prod-smoke.sh', ['exit 0']);
    exe('compose', [
      `echo "compose $*" >> '${dir}/calls.log'`,
      '[ "$*" = "config --images" ] && { echo weave-backend; echo weave-frontend; exit 0; }',
      failBuild ? `[ "$*" = "${failBuild}" ] && exit 1` : '',
      'exit 0',
    ]);
    // 실행 중 컨테이너의 이미지는 old, 빌드가 옮긴 태그는 new — 되돌리기는 <태그>:pre-verify(old)를 다시 태그해야 한다
    exe('bin/docker', [
      `echo "docker $*" >> '${dir}/calls.log'`,
      'case "$*" in',
      '  "inspect -f {{.Image}} "*) echo sha256:old ;;',
      '  "image inspect -f {{.Id}} "*:pre-verify) echo sha256:old ;;',
      '  "image inspect -f {{.Id}} "*) echo sha256:new ;;',
      'esac',
      'exit 0',
    ]);
    const r = spawnSync('sh', [path.join(dir, 'scripts/prod-verify.sh')], {
      env: { PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, PROD_COMPOSE: path.join(dir, 'compose') },
      encoding: 'utf8',
    });
    const calls = readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n');
    return { status: r.status, stderr: r.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('prod-verify.sh image builds', () => {
  it('pulls the frontend base on every build but not the backend base', () => {
    const r = runVerify();
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('compose '))).toEqual([
      'compose config --images',
      'compose build backend',
      'compose build --pull frontend',
    ]);
  });

  it.each([
    ['build backend', 'backend image build failed'],
    ['build --pull frontend', 'frontend image build failed'],
  ])('a failed `%s` stops there and puts both tags back on the running images', (failBuild, reason) => {
    const r = runVerify({ failBuild });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`VERIFY FAIL: ${reason}`);
    expect(r.calls.filter((c) => c.startsWith('compose ')).at(-1)).toBe(`compose ${failBuild}`);
    expect(r.calls).toContain('docker tag weave-backend:pre-verify weave-backend');
    expect(r.calls).toContain('docker tag weave-frontend:pre-verify weave-frontend');
  });
});
