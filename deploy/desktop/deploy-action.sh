#!/usr/bin/env bash
# Executado somente no runner do GitHub. Segredos chegam pelo ambiente.
set -Eeuo pipefail
umask 077
deploy_stage='validar configuração'
fail() {
  printf '::error::%s\n' "$1" >&2
  exit 1
}
# Nunca imprimir BASH_COMMAND nem habilitar set -x: os comandos manipulam
# credenciais. A etapa e a linha permitem diagnosticar sem expor valores.
trap 'status=$?; printf "::error::Falha na etapa: %s (linha %s, código %s).\n" "$deploy_stage" "$LINENO" "$status" >&2; exit "$status"' ERR
flavor=${SIGMA_DEPLOY_FLAVOR:-desktop}
[[ "$flavor" == web || "$flavor" == desktop ]] || fail 'SIGMA_DEPLOY_FLAVOR inválido: use web ou desktop.'
deploy_root=sigma
if [[ "$flavor" == web ]]; then
  deploy_root=sigma-web
  for name in SIGMA_OWNER_EMAIL SIGMA_ACCESS_ISSUER SIGMA_ACCESS_AUD; do
    [[ -n "${!name:-}" ]] || fail "Secret obrigatório ausente: $name. Cadastre no environment oci."
    [[ "${!name}" != *$'\n'* && "${!name}" != *$'\r'* ]] || fail "$name contém quebra de linha. Cadastre somente o valor em uma linha, sem espaços ou quebras extras."
  done
  [[ "$SIGMA_OWNER_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+$ ]] || fail 'SIGMA_OWNER_EMAIL inválido: use somente o e-mail, sem nome, aspas ou espaços.'
  [[ "$SIGMA_ACCESS_ISSUER" =~ ^https://[a-zA-Z0-9-]+\.cloudflareaccess\.com/?$ ]] || fail 'SIGMA_ACCESS_ISSUER inválido: use https://NOME-DA-EQUIPE.cloudflareaccess.com, sem caminhos, aspas ou espaços. Não use o hostname do Sigma.'
  [[ "$SIGMA_ACCESS_AUD" =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'SIGMA_ACCESS_AUD inválido: copie somente o Application Audience (AUD) da aplicação Access, sem aspas, colchetes, prefixos ou espaços.'
fi
for name in OCI_HOST OCI_USER OCI_PORT OCI_SSH_KEY OCI_KNOWN_HOSTS CF_TUNNEL_TOKEN REGISTRY_USER REGISTRY_TOKEN OCI_ARCH SIGMA_CPUS SIGMA_MEMORY; do
  [[ -n "${!name:-}" ]] || fail "Configuração obrigatória ausente: $name. Confira os Secrets/Variables usados pelo job."
done
[[ "$OCI_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'OCI_HOST inválido: use somente o IP/hostname, sem usuário@, protocolo, caminho ou espaços.'
[[ "$OCI_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || fail 'OCI_USER inválido: use somente o usuário SSH, por exemplo ubuntu, sem @IP ou espaços.'
[[ "$OCI_PORT" =~ ^[0-9]{1,5}$ ]] || fail 'OCI_PORT inválido: use somente o número da porta, por exemplo 22.'
((10#$OCI_PORT >= 1 && 10#$OCI_PORT <= 65535)) || fail 'OCI_PORT fora do intervalo permitido: use uma porta entre 1 e 65535.'
[[ "$OCI_ARCH" == arm64 || "$OCI_ARCH" == amd64 ]] || fail 'OCI_ARCH inválido: use arm64 ou amd64 na variável de repositório.'
[[ "$SIGMA_CPUS" =~ ^[0-9]+([.][0-9]+)?$ ]] || fail 'SIGMA_CPUS inválido: use um número com ponto decimal, por exemplo 1.0.'
[[ "$SIGMA_MEMORY" =~ ^[1-9][0-9]*[mg]$ ]] || fail 'SIGMA_MEMORY inválido: use por exemplo 3g ou 3072m, sem espaços.'
if [[ -n "${SIGMA_VNC_PASSWORD:-}" && ! "$SIGMA_VNC_PASSWORD" =~ ^[a-zA-Z0-9]{8}$ ]]; then
  fail 'SIGMA_VNC_PASSWORD precisa ter exatamente 8 caracteres alfanuméricos.'
fi
echo 'Configuração validada; verificando a referência da imagem.'
deploy_stage='validar imagem e identificar a release'
[[ -s image-reference.txt ]] || fail 'image-reference.txt ausente ou vazio. Confira o download do artifact sigma-image-reference neste job.'
image=$(cat image-reference.txt)
[[ "$image" =~ ^ghcr.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || fail 'Referência de imagem inválida no artifact: esperado ghcr.io/...@sha256:DIGEST. Execute o workflow completo com o código atualizado.'
release_id="${GITHUB_RUN_ID:-}-${GITHUB_RUN_ATTEMPT:-}"
[[ "$release_id" =~ ^[0-9]+-[0-9]+$ ]] || fail 'GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT inválidos ou ausentes. Execute pelo GitHub Actions.'
deploy_stage='preparar arquivos da release'
workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
mkdir -p "$workdir/release/secrets"
printf '%s\n' "$OCI_SSH_KEY" > "$workdir/id"
printf '%s\n' "$OCI_KNOWN_HOSTS" > "$workdir/known_hosts"
ssh_args=(-i "$workdir/id" -o BatchMode=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$workdir/known_hosts" -o ConnectTimeout=15
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
destination="$OCI_USER@$OCI_HOST"
for file in deploy-oci.sh bootstrap-docker.sh; do
  cp "deploy/desktop/$file" "$workdir/release/"
done
cp "deploy/$flavor/compose.yml" "$workdir/release/"
if [[ "$flavor" == desktop ]]; then cp deploy/desktop/compose.tunnel.yml "$workdir/release/"; fi
printf '%s\n' "$CF_TUNNEL_TOKEN" > "$workdir/release/secrets/tunnel-token"
printf '%s\n' "$REGISTRY_TOKEN" > "$workdir/release/secrets/registry-token"
printf '%s\n' "$REGISTRY_USER" > "$workdir/release/registry-user"
if [[ -n "${SIGMA_VNC_PASSWORD:-}" ]]; then
  printf '%s\n' "$SIGMA_VNC_PASSWORD" > "$workdir/release/secrets/vnc-password"
fi
printf 'SIGMA_IMAGE=%s\nSIGMA_CPUS=%s\nSIGMA_MEMORY=%s\nOCI_ARCH=%s\n' \
  "$image" "$SIGMA_CPUS" "$SIGMA_MEMORY" "$OCI_ARCH" > "$workdir/release/.env"
if [[ "$flavor" == web ]]; then
  printf 'SIGMA_DEPLOY_FLAVOR=web\nSIGMA_OWNER_EMAIL=%s\nSIGMA_ACCESS_ISSUER=%s\nSIGMA_ACCESS_AUD=%s\nSIGMA_PUBLIC_ORIGIN=https://sigma.ricardohenrique.com\n' \
    "$SIGMA_OWNER_EMAIL" "$SIGMA_ACCESS_ISSUER" "$SIGMA_ACCESS_AUD" >> "$workdir/release/.env"
fi
tar -czf "$workdir/release.tar.gz" -C "$workdir/release" .
echo 'Release preparada; iniciando conexão SSH com a OCI.'
deploy_stage='conectar à OCI por SSH'
ssh "${ssh_args[@]}" -p "$OCI_PORT" "$destination" \
  "umask 077; mkdir -p \"\$HOME/$deploy_root/incoming\" \"\$HOME/$deploy_root/releases\"; chmod 700 \"\$HOME/$deploy_root\" \"\$HOME/$deploy_root/incoming\" \"\$HOME/$deploy_root/releases\""
deploy_stage='transferir release por SCP'
scp "${ssh_args[@]}" -P "$OCI_PORT" "$workdir/release.tar.gz" \
  "$destination:$deploy_root/incoming/$release_id.tar.gz"
# release_id contém apenas números e hífen, validado acima.
deploy_stage='executar deploy remoto na OCI'
ssh "${ssh_args[@]}" -p "$OCI_PORT" "$destination" \
  "umask 077; mkdir -p \"\$HOME/$deploy_root/releases/$release_id\" && tar -xzf \"\$HOME/$deploy_root/incoming/$release_id.tar.gz\" -C \"\$HOME/$deploy_root/releases/$release_id\" && rm \"\$HOME/$deploy_root/incoming/$release_id.tar.gz\" && bash \"\$HOME/$deploy_root/releases/$release_id/deploy-oci.sh\" \"\$HOME/$deploy_root/releases/$release_id\""
