# Deploy do Sigma por GitHub Actions na nova OCI

**Referência histórica da stack noVNC.** A pipeline atual publica a versão
web com dois perfis; use [o guia atualizado](../web/README.md), incluindo os
novos Secrets do Access e a rota `http://web:3000`.

Destino: VPS própria do Sigma, **1 vCPU / 6 GB de RAM**, sem depender do
Matchlogs. A publicação usa `sigma.ricardohenrique.com` e um Tunnel próprio.

## O que a pipeline faz

O workflow `.github/workflows/deploy-oci.yml` roda ao publicar código na
`main`, ou manualmente em **Actions → Deploy Sigma OCI → Run workflow**.

1. Constrói Electron, Playwright e noVNC no runner do GitHub.
2. Publica a imagem no GHCR e testa sua inicialização em um container.
3. Só libera o deploy se display, aplicação, HTTP e VNC responderem.
4. Transfere os manifests e credenciais por SSH com verificação da chave
   do servidor. O token do registro é temporário e é removido após o deploy.
5. Na primeira execução, instala Docker e Compose pelo repositório oficial
   se estiverem ausentes. Esse bootstrap suporta **Ubuntu/Debian** e exige
   root ou `sudo -n` para a instalação e para operar o daemon, se necessário.
6. Baixa a imagem pelo digest testado, inicia o Sigma e o `cloudflared`,
   verifica a saúde do app e a conexão do Tunnel. Uma falha tenta restaurar
   a release anterior, preservando o volume de dados.

O build não roda na VPS. O Sigma começa com limite de 1 CPU e 3 GiB de RAM;
o Tunnel tem limite de 256 MiB. As releases ficam em `~/sigma/releases/`, a
ativa em `~/sigma/current` e os segredos persistentes em `~/sigma/secrets/`
(diretório 0700). O volume do app é `sigma_profile`.

## Preparar a OCI uma vez

- Confirme o sistema instalado e a arquitetura com `uname -m`. A pipeline
  assume ARM64 (`aarch64`), comum na OCI Ampere. Se o resultado for `x86_64`,
  configure a variável de repositório `OCI_ARCH=amd64` antes de executar.
  O deploy rejeita imagens de outra arquitetura antes de alterar containers.
- Cadastre a chave pública de deploy em `~/.ssh/authorized_keys` do usuário
  escolhido. A correspondente chave privada vai exclusivamente no Secret
  do GitHub. Acesso root ao Docker equivale a administração da VPS.
- O runner precisa alcançar a porta SSH da máquina. Se o SSH estiver
  restrito por IP, use um runner com saída permitida pela regra existente.
  Não há necessidade de abrir 80, 443, 5900 ou 6080 como entrada para o app.
- Permita saída para os repositórios de pacotes, GHCR e Cloudflare: HTTPS
  na porta 443 e o Tunnel em 7844 TCP/UDP. A pipeline não modifica o
  firewall, Security Lists ou regras da OCI.
- Confirme a chave pública do servidor pelo console da OCI antes de salvá-la
  em `OCI_KNOWN_HOSTS`. A pipeline não usa `StrictHostKeyChecking=no` nem
  confia automaticamente no resultado de `ssh-keyscan` durante o deploy.

Não é necessário instalar um runner do GitHub na VPS.

## Criar o Tunnel e o Access uma vez

No painel da Cloudflare, na conta que contém `ricardohenrique.com`:

1. Crie uma aplicação **Access / Self-hosted** para
   `sigma.ricardohenrique.com`, todos os caminhos, com uma política Allow
   para os e-mails autorizados. Faça isso antes de publicar a rota.
2. Crie um **Cloudflare Tunnel** gerenciado pelo painel, por exemplo
   `sigma-oci`. Copie somente o token do conector para o Secret
   `CF_TUNNEL_TOKEN` no GitHub. Não envie o token no chat nem cole o comando
   completo de instalação no Secret. O container da pipeline executa o
   conector; não é necessário instalar outro `cloudflared` pelo terminal.
3. Cadastre a rota pública:

   | Campo | Valor |
   |---|---|
   | Subdomínio | `sigma` |
   | Domínio | `ricardohenrique.com` |
   | Tipo | HTTP |
   | Serviço | `desktop:6080` |

   O endereço é **`http://desktop:6080`**: o conector desta pipeline roda
   na mesma rede Docker do Sigma. `localhost:6080` dentro dele apontaria
   para o próprio conector.
4. Mantenha WebSockets habilitados, use as regras WAF disponíveis no plano
   e evite cache nesse hostname. A rota gerenciada pelo painel normalmente
   cria o CNAME do Tunnel; não é necessário apontar um registro A para a VPS.

A pipeline conecta o Tunnel usando o token fornecido. Ela **não cria** a
conta Cloudflare, o Tunnel, a aplicação Access, as políticas ou o DNS pela
API: essa configuração inicial permanece no painel.

## Secrets no GitHub

No repositório `ricardohsousa/google-maps-sigma-scrapper`, crie o environment
**`oci`**, em **Settings → Environments**, e cadastre:

| Secret | Conteúdo |
|---|---|
| `OCI_HOST` | IP público ou hostname SSH da nova VPS |
| `OCI_USER` | Usuário SSH (`ubuntu` em muitas imagens Ubuntu OCI) |
| `OCI_SSH_KEY` | Chave privada de deploy completa, com as quebras de linha |
| `OCI_KNOWN_HOSTS` | Linha(s) verificadas de `known_hosts` para essa máquina |
| `CF_TUNNEL_TOKEN` | Token do Tunnel dedicado `sigma-oci` |
| `OCI_PORT` | Opcional; padrão `22` |
| `SIGMA_VNC_PASSWORD` | Opcional; exatamente 8 caracteres alfanuméricos |

Para uma porta SSH diferente de 22, a linha de `known_hosts` deve usar
`[HOST]:PORTA`. Os segredos nunca devem entrar nos arquivos do repositório.
Se `SIGMA_VNC_PASSWORD` não for fornecida, a primeira execução gera uma
senha e os próximos deploys a preservam. Consulte-a por SSH na própria VPS:

```bash
cat ~/sigma/secrets/vnc-password
```

Se fornecer esse Secret, os deploys passam a aplicar o valor dele. Para
trocar o token do Tunnel, atualize `CF_TUNNEL_TOKEN` e execute novamente.

Variáveis opcionais:

| Variable | Escopo | Padrão |
|---|---|---|
| `OCI_ARCH` | **Repositório**, pois o build não usa o environment `oci` | `arm64` (alternativa: `amd64`) |
| `SIGMA_CPUS` | Environment `oci` ou repositório | `1.0` |
| `SIGMA_MEMORY` | Environment `oci` ou repositório | `3g` |

O workflow usa `GITHUB_TOKEN` para publicar e baixar a imagem. Não exige um
PAT do GHCR. Se já existir um pacote com esse nome, confira se ele concede
acesso ao repositório em **Package settings → Manage Actions access**.

## Primeira execução e verificação

Publique no GitHub o workflow, a pasta `deploy/desktop`, `.dockerignore` e
**todos os fontes atuais referenciados pelo Dockerfile**, incluindo
`places-api.js` e `utils/maps-settings.js`. A pipeline constrói o checkout
do GitHub, não o diretório local da sua máquina.

Configure os Secrets e execute **Deploy Sigma OCI**. O job de deploy usa o
environment `oci`; caso você configure revisores nesse environment, o
GitHub aguardará a aprovação definida por você.

Depois de ambos os jobs ficarem verdes:

1. Abra em janela anônima:
   `https://sigma.ricardohenrique.com/vnc.html?autoconnect=true&resize=scale`.
2. Confirme que o Access pede login antes do noVNC e bloqueia e-mails não
   autorizados. Entre com um e-mail permitido e a senha VNC.
3. Faça uma extração pequena, scoring e exportação. Feche a aba e reabra
   para verificar os dados e o processo remoto.

O teste de conexão `/ready` confirma que o conector alcançou a Cloudflare;
ele não comprova a política Access, o DNS ou a navegação pública.

Diagnóstico na VPS:

```bash
cd ~/sigma/current
sudo docker compose -p sigma -f compose.yml -f compose.tunnel.yml ps
sudo docker compose -p sigma -f compose.yml -f compose.tunnel.yml logs --tail=100 desktop cloudflared
```

As releases e imagens antigas ficam disponíveis para retorno. Não há prune
automático nem remoção de volumes. Monitore o espaço em disco. O rollback
restaura a imagem/configuração anterior, não desfaz mudanças feitas nos dados
pelo app; faça backups do perfil antes de atualizações que migrem os dados.

Limites do acesso remoto, backup e restauração: [README.md](README.md).

Referências:
[runners ARM do GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Docker no Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[token do Tunnel](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/),
[parâmetros do cloudflared](https://developers.cloudflare.com/tunnel/reference/run-parameters/).
