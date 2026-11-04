const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const source = path.join(__dirname, '..', 'deploy', 'desktop');

function fixture(t, options = {}) {
  const taskHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-deploy-test-'));
  t.after(() => fs.rmSync(taskHome, { recursive: true, force: true }));
  const root = path.join(taskHome, options.web ? 'sigma-web' : 'sigma');
  const release = path.join(root, 'releases', 'new');
  const bin = path.join(taskHome, 'bin');
  const calls = path.join(taskHome, 'docker-calls.jsonl');
  fs.mkdirSync(path.join(release, 'secrets'), { recursive: true });
  fs.mkdirSync(bin);
  for (const filename of ['compose.yml', 'compose.tunnel.yml', 'deploy-oci.sh']) {
    fs.copyFileSync(path.join(source, filename), path.join(release, filename));
  }
  fs.writeFileSync(path.join(release, 'bootstrap-docker.sh'), '#!/bin/bash\nexit 0\n');
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  fs.writeFileSync(path.join(release, '.env'), `OCI_ARCH=${options.arch || arch}\nSIGMA_IMAGE=ghcr.io/example/sigma@sha256:${'1'.repeat(64)}\n`);
  if (options.web) {
    fs.copyFileSync(path.join(source, '../web/compose.yml'), path.join(release, 'compose.yml'));
    fs.appendFileSync(path.join(release, '.env'), 'SIGMA_DEPLOY_FLAVOR=web\nSIGMA_OWNER_EMAIL=owner@example.com\nSIGMA_ACCESS_ISSUER=https://test.cloudflareaccess.com\nSIGMA_ACCESS_AUD=test\n');
  }
  fs.writeFileSync(path.join(release, 'registry-user'), 'test-user\n');
  fs.writeFileSync(path.join(release, 'secrets', 'registry-token'), 'fake-registry-token\n');
  fs.writeFileSync(path.join(release, 'secrets', 'tunnel-token'), 'fake-tunnel-token\n');
  if (options.previous) {
    const previous = path.join(root, 'releases', 'previous');
    fs.mkdirSync(previous);
    for (const filename of ['compose.yml', 'compose.tunnel.yml']) {
      fs.copyFileSync(path.join(source, filename), path.join(previous, filename));
    }
    fs.symlinkSync(previous, path.join(root, 'current'));
    fs.mkdirSync(path.join(root, 'secrets'));
    fs.writeFileSync(path.join(root, 'secrets', 'vnc-password'), 'abcdefgh\n');
  }
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['DOCKER_CALLS'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
new = '--project-directory' in args and args[args.index('--project-directory') + 1].endswith('/new')
if new and 'up' in args and os.environ.get('FAIL_UP') == '1': sys.exit(1)
if new and 'exec' in args and os.environ.get('FAIL_TUNNEL') == '1': sys.exit(1)
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  return {
    taskHome, root, release, calls,
    run(extra = {}) {
      return spawnSync('bash', [path.join(release, 'deploy-oci.sh'), release], {
        env: { ...process.env, HOME: taskHome, PATH: `${bin}:${process.env.PATH}`, DOCKER_CALLS: calls, ...extra },
        encoding: 'utf8',
      });
    },
    commands() {
      return fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [];
    },
  };
}

test('deploy publica release saudável e remove as credenciais temporárias', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.realpathSync(path.join(f.root, 'current')), f.release);
  assert.equal(fs.existsSync(path.join(f.release, 'secrets')), false);
  assert.match(fs.readFileSync(path.join(f.root, 'secrets', 'vnc-password'), 'utf8'), /^[a-f0-9]{8}\n$/);
  assert.equal(fs.statSync(path.join(f.root, 'secrets')).mode & 0o777, 0o700);
  assert.ok(f.commands().some(args => args.includes('/ready') || args.some(arg => arg.endsWith('/ready'))));
  assert.doesNotMatch(result.stdout + result.stderr, /fake-registry-token|fake-tunnel-token/);
});

for (const failure of ['FAIL_UP', 'FAIL_TUNNEL']) {
  test(`deploy restaura release anterior quando ${failure} falha`, t => {
    const f = fixture(t, { previous: true });
    const result = f.run({ [failure]: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(fs.realpathSync(path.join(f.root, 'current')), path.join(f.root, 'releases', 'previous'));
    assert.equal(fs.readFileSync(path.join(f.root, 'secrets', 'vnc-password'), 'utf8'), 'abcdefgh\n');
    assert.ok(f.commands().some(args => args.includes('up') && args.includes(path.join(f.root, 'releases', 'previous'))));
    assert.ok(f.commands().every(args => !args.includes('down') && !args.includes('prune')));
    assert.equal(fs.existsSync(path.join(f.release, 'secrets')), false);
  });
}

test('deploy rejeita arquitetura incompatível antes de alterar containers', t => {
  const f = fixture(t, { arch: process.arch === 'arm64' ? 'amd64' : 'arm64' });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Arquitetura incompatível/);
  assert.deepEqual(f.commands(), []);
});

test('deploy web usa stack própria e não depende de senha VNC', t => {
  const f = fixture(t, { web: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.realpathSync(path.join(f.root, 'current')), f.release);
  assert.equal(fs.existsSync(path.join(f.root, 'secrets', 'vnc-password')), false);
  assert.ok(f.commands().some(args => args.includes('--project-name') && args.includes('sigma-web')));
  assert.ok(f.commands().some(args => args.includes('web') && args.includes('exec')));
  assert.ok(f.commands().every(args => !args.includes(path.join(f.release, 'compose.tunnel.yml'))));
});

test('deploy web restaura a release web anterior após falha de atualização', t => {
  const f = fixture(t, { web: true, previous: true });
  const result = f.run({ FAIL_UP: '1' });
  assert.notEqual(result.status, 0);
  assert.ok(f.commands().some(args => args.includes('up') && args.includes('sigma-web') && args.includes(path.join(f.root, 'releases', 'previous'))));
});
