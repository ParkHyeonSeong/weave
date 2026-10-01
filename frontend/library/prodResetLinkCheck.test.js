// scripts/prod-reset-link-check.sh — make prod-deploy의 첫 단계(비밀번호 재설정 링크 주소 검사).
// 같은 fixture로 backend/tests/test_password_reset.py가 가짜 토큰 링크의 실제 주소(link_base)를 확인하므로,
// 여기서는 스크립트가 같은 설정을 통과·실패시키고 같은 주소를 보고하는지, 그리고 make prod-deploy가 빌드 전에 멈추는지 본다.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/prod-reset-link-check.sh');
const CASES = JSON.parse(readFileSync(path.join(ROOT, 'backend/tests/fixtures/reset_link_origin_cases.json'), 'utf8'));
const SECRETS = { JWT_SECRET_KEY: 'jwt-secret-value', ENCRYPT_KEY: 'encrypt-secret-value' };

// `docker compose config --format json backend`와 같은 모양: 2칸 들여쓰기, environment는 맵, Go 인코더처럼 < > &는 \u 이스케이프.
function composeJson(env) {
  const doc = {
    name: 'weave',
    services: {
      backend: { environment: { ...env, ...SECRETS } },
      db: { environment: { POSTGRES_PASSWORD: 'db-secret-value' } },
    },
  };
  return JSON.stringify(doc, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function envOf(c) {
  const env = { ALLOWED_ORIGINS: c.allowed_origins ?? '' };  // 변수가 없으면 compose는 빈 문자열을 넘긴다
  if (c.frontend_url != null) env.FRONTEND_URL = c.frontend_url;
  return env;
}

// PROD_COMPOSE 자리에 들어갈 가짜 compose. 받은 인자를 calls.log에 남기고, config 요청에만 준비한 JSON을 낸다.
function fakeCompose(env, { readFails = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'reset-link-check-'));
  writeFileSync(path.join(dir, 'config.json'), composeJson(env));
  const bin = path.join(dir, 'compose');
  writeFileSync(bin, [
    '#!/bin/sh',
    `echo "$*" >> '${dir}/calls.log'`,
    readFails ? 'echo "couldn\'t find env file" >&2; exit 1' : '',
    `[ "$*" = "config --format json backend" ] && exec cat '${dir}/config.json'`,
    'exit 0',  // config --images 등: 이미지 이름이 없으니 prod-verify가 빌드 전에 실패한다
  ].join('\n'));
  chmodSync(bin, 0o755);
  return {
    bin,
    calls: () => (existsSync(path.join(dir, 'calls.log')) ? readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : []),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function runCheck(prodCompose, extraEnv = {}) {
  const r = spawnSync('sh', [SCRIPT], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PROD_COMPOSE: prodCompose, ...extraEnv },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

function hasCommand(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
}

describe('prod-reset-link-check.sh', () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.ok ? 'passes' : `fails on ${c.setting}`} and reports ${c.link_base}`, () => {
      const fake = fakeCompose(envOf(c));
      try {
        const r = runCheck(fake.bin);
        if (c.ok) {
          expect(r.status).toBe(0);
          expect(r.stdout).toContain(`RESET LINK OK: password-reset links will start with ${c.link_base}/auth/reset`);
          expect(r.stdout).toContain('checks the format only');
        } else {
          expect(r.status).toBe(1);
          expect(r.stderr).toContain('RESET LINK CHECK FAIL');
          expect(r.stderr).toContain('Nothing was built or changed');
          expect(r.stderr).toContain(c.setting);
          expect(r.stderr).toContain(c.reason);
          expect(r.stderr).toContain(`Reset links would start with ${c.link_base}/auth/reset?token=`);
        }
        // 이 설정들만 읽는다 — 비밀값은 출력하지 않는다
        expect(r.all).not.toMatch(/secret-value/);
        expect(fake.calls()).toEqual(['config --format json backend']);
      } finally {
        fake.cleanup();
      }
    });
  }

  it('fails without echoing compose output when the settings cannot be read', () => {
    const fake = fakeCompose({}, { readFails: true });
    try {
      const r = runCheck(fake.bin);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('could not read the backend settings from compose');
      expect(r.stderr).toContain('config --quiet');
      expect(r.all).not.toContain("couldn't find env file");
    } finally {
      fake.cleanup();
    }
  });

  it('treats a literal * entry as text, not a file glob', () => {
    const fake = fakeCompose({ ALLOWED_ORIGINS: '*,https://weave.acme.co.kr' });
    try {
      const r = runCheck(fake.bin);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('ALLOWED_ORIGINS entry "*" is not an origin');
    } finally {
      fake.cleanup();
    }
  });
});

describe.skipIf(!hasCommand('make', ['--version']))('make prod-deploy', () => {
  function deploy(env, makeFlags = []) {
    const fake = fakeCompose(env);
    const r = spawnSync('make', [...makeFlags, '--no-print-directory', 'prod-deploy', `PROD_COMPOSE=${fake.bin}`], {
      cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8',
    });
    const calls = fake.calls();
    fake.cleanup();
    return { status: r.status, all: r.stdout + r.stderr, calls };
  }

  it('stops at the check before any image is built or container replaced', () => {
    const r = deploy({ ALLOWED_ORIGINS: 'https://weave.example.com' });
    expect(r.status).not.toBe(0);
    expect(r.all).toContain('RESET LINK CHECK FAIL');
    expect(r.calls).toEqual(['config --format json backend']);  // prod-verify(config --images·build)와 up -d가 없다
  });

  it('runs prod-verify only after the check passes', () => {
    const r = deploy({ ALLOWED_ORIGINS: 'https://weave.acme.co.kr' });
    // 가짜 compose에는 이미지 이름이 없어 prod-verify가 빌드 전에 실패한다 — 여기서는 순서만 본다
    expect(r.status).not.toBe(0);
    expect(r.all.indexOf('RESET LINK OK')).toBeGreaterThanOrEqual(0);
    expect(r.all.indexOf('RESET LINK OK')).toBeLessThan(r.all.indexOf('VERIFY FAIL'));
    expect(r.calls).toEqual(['config --format json backend', 'config --images']);
  });

  // 포트가 범위 밖이면(ALLOWED_ORIGINS 첫·뒤 항목, FRONTEND_URL) make -j4에서도 검사에서 멈추고 prod-verify로 가지 않는다
  for (const c of CASES.filter((x) => !x.ok && x.reason === 'invalid port')) {
    it(`make -j4 stops at the check: ${c.name}`, () => {
      const r = deploy(envOf(c), ['-j4']);
      expect(r.status).not.toBe(0);
      expect(r.all).toContain('RESET LINK CHECK FAIL');
      expect(r.all).toContain(`${c.setting}`);
      expect(r.all).toContain('invalid port');
      expect(r.all).not.toContain('RESET LINK OK');
      expect(r.all).not.toContain('VERIFY FAIL');
      expect(r.calls).toEqual(['config --format json backend']);  // config --images·build·up -d 없음
    });
  }

  it('make -j4 still runs prod-verify after the check when the port is valid', () => {
    const r = deploy({ ALLOWED_ORIGINS: 'https://weave.acme.co.kr:65535' }, ['-j4']);
    expect(r.status).not.toBe(0);  // 가짜 compose라 prod-verify가 빌드 전에 실패한다 — 순서만 본다
    expect(r.all.indexOf('RESET LINK OK')).toBeGreaterThanOrEqual(0);
    expect(r.all.indexOf('RESET LINK OK')).toBeLessThan(r.all.indexOf('VERIFY FAIL'));
    expect(r.calls).toEqual(['config --format json backend', 'config --images']);
  });
});

// 실제 compose가 docker-compose.prod.yml과 env 파일로 backend에 넘길 값을 스크립트가 읽는지(출력 형식이 바뀌면 여기서 드러난다).
describe.skipIf(!hasCommand('docker', ['compose', 'version']))('with the real docker compose config', () => {
  const example = readFileSync(path.join(ROOT, '.env.production.example'), 'utf8');

  function checkWith(envText) {
    const dir = mkdtempSync(path.join(tmpdir(), 'reset-link-env-'));
    const envFile = path.join(dir, 'env');
    writeFileSync(envFile, envText);
    try {
      return runCheck(`docker compose --env-file ${envFile} -f ${path.join(ROOT, 'docker-compose.prod.yml')}`, {
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('fails on the untouched example file (example domain)', () => {
    const r = checkWith(example);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ALLOWED_ORIGINS entry "https://weave.example.com" is a reserved example domain');
    expect(r.all).not.toMatch(/CHANGE_ME/);
  });

  it('fails when ALLOWED_ORIGINS is missing (links would go to localhost)', () => {
    const r = checkWith(example.replace(/^ALLOWED_ORIGINS=.*$/m, ''));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ALLOWED_ORIGINS is empty');
    expect(r.stderr).toContain('Reset links would start with http://localhost:3000/auth/reset?token=');
  });

  it('fails when the port is out of range (65536)', () => {
    const r = checkWith(example.replace(/^ALLOWED_ORIGINS=.*$/m, 'ALLOWED_ORIGINS=https://weave.acme.co.kr:65536'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ALLOWED_ORIGINS entry "https://weave.acme.co.kr:65536" has an invalid port');
  });

  it('passes with a public https origin and reports it', () => {
    const r = checkWith(example.replace(/^ALLOWED_ORIGINS=.*$/m, 'ALLOWED_ORIGINS=https://weave.acme.co.kr'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('RESET LINK OK: password-reset links will start with https://weave.acme.co.kr/auth/reset');
  });
});
