const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const source = path.join(__dirname, '..');
function run(t, patch = {}, { image = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-action-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['deploy/desktop/deploy-action.sh', 'deploy/desktop/deploy-oci.sh', 'deploy/desktop/bootstrap-docker.sh', 'deploy/web/deploy-action.sh', 'deploy/web/compose.yml']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin', 'ssh'), '#!/bin/bash\necho "SSH simulado: conexão indisponível" >&2\nexit 73\n', { mode: 0o755 });
  if (image) fs.writeFileSync(path.join(root, 'image-reference.txt'), `ghcr.io/example/sigma-web@sha256:${'a'.repeat(64)}\n`);
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    TMPDIR: root,
    OCI_HOST: '192.0.2.1', OCI_USER: 'ubuntu', OCI_PORT: '22',
    OCI_SSH_KEY: 'PRIVATE_KEY_TEST_SENTINEL', OCI_KNOWN_HOSTS: 'HOST_KEY_TEST_SENTINEL',
    CF_TUNNEL_TOKEN: 'TUNNEL_TOKEN_TEST_SENTINEL', REGISTRY_USER: 'test-user', REGISTRY_TOKEN: 'REGISTRY_TOKEN_TEST_SENTINEL',
    OCI_ARCH: 'arm64', SIGMA_CPUS: '1.0', SIGMA_MEMORY: '3g',
    SIGMA_OWNER_EMAIL: 'owner@example.com', SIGMA_ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com', SIGMA_ACCESS_AUD: 'audience-test',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', SIGMA_VNC_PASSWORD: '', ...patch,
  };
  const result = spawnSync('bash', ['deploy/web/deploy-action.sh'], { cwd: root, env, encoding: 'utf8' });
  const output = result.stdout + result.stderr;
  for (const name of ['OCI_SSH_KEY', 'OCI_KNOWN_HOSTS', 'CF_TUNNEL_TOKEN', 'REGISTRY_TOKEN']) assert.ok(!output.includes(env[name]), `Vazou ${name}`);
  return { ...result, output };
}
for (const [field, value] of Object.entries({
  SIGMA_OWNER_EMAIL: 'NOME owner@example.com', SIGMA_ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com/caminho',
  SIGMA_ACCESS_AUD: '["audience"]', OCI_HOST: 'ubuntu@192.0.2.1', OCI_USER: 'ubuntu@host',
  OCI_PORT: '70000', OCI_ARCH: 'aarch64', SIGMA_CPUS: '1,0', SIGMA_MEMORY: '3 GB',
})) {
  test(`preflight identifica ${field} inválido sem divulgar credenciais`, t => {
    const result = run(t, { [field]: value });
    assert.equal(result.status, 1);
    assert.match(result.output, new RegExp(`::error::.*${field}`));
    assert.ok(!result.output.includes(value));
    assert.doesNotMatch(result.output, /iniciando conexão SSH/);
  });
}
test('preflight identifica Secret vazio e quebra de linha', t => {
  assert.match(run(t, { SIGMA_ACCESS_AUD: '' }).output, /Secret obrigatório ausente: SIGMA_ACCESS_AUD/);
  assert.match(run(t, { SIGMA_ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com\n' }).output, /SIGMA_ACCESS_ISSUER contém quebra de linha/);
});
test('preflight identifica artifact ausente antes do SSH', t => {
  const result = run(t, {}, { image: false });
  assert.equal(result.status, 1);
  assert.match(result.output, /image-reference.txt ausente ou vazio/);
});
test('falha SSH informa a etapa sem imprimir comando ou Secrets', t => {
  const result = run(t);
  assert.equal(result.status, 73);
  assert.match(result.output, /Configuração validada/);
  assert.match(result.output, /Falha na etapa: conectar à OCI por SSH/);
});
