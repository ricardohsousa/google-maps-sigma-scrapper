# Sigma web: Cloudflare Access, perfis e migração

Para seguir a instalação do início ao fim, use o
[manual completo de publicação](../../PASSO_A_PASSO_SIGMA_OCI.md). Este README
fica como referência técnica complementar.

Esta é a implantação usada por `.github/workflows/deploy-oci.yml`. A
aplicação roda como servidor Node.js e mantém sessões individuais autenticadas
pelo Cloudflare Access. O desktop continua disponível para uso e exportação
dos dados locais. A stack noVNC anterior não implementa os perfis.

## Acesso e perfis

O backend valida a assinatura RSA, emissor, audiência e expiração do JWT de
`Cf-Access-Jwt-Assertion`. Não confia no e-mail de um header isolado e não
possui modo de produção sem autenticação. Depois da validação, o usuário
precisa estar ativo no cadastro do Sigma.

- **Proprietário:** gerencia a base, extrações, scoring, configurações,
  usuários, importação e exportação. Possui também o acompanhamento dos leads.
- **Operador:** consulta leads, análises e Kanban; na tela **Trabalhar leads**
  altera apenas anotações, status de atendimento e a etapa do card. APIs
  administrativas e campos adicionais são rejeitados no servidor.

O primeiro proprietário é cadastrado no startup por `SIGMA_OWNER_EMAIL`,
somente quando não existe um cadastro persistente. As próximas execuções
preservam os usuários existentes. Não é possível desativar ou rebaixar o
último proprietário. E-mail e identidade `sub` do Access ficam vinculados
após a primeira autenticação válida. Mudar o provedor de identidade ou
transferir uma conta pode exigir revisar esse vínculo no cadastro persistido.

O proprietário cadastra outros usuários na tela **Usuários**. O e-mail
também precisa estar permitido na política do Cloudflare Access. Não há
segunda senha local no Sigma.

## Configuração inicial da Cloudflare

1. Crie uma aplicação Access **Self-hosted** para todos os caminhos de
   `sigma.ricardohenrique.com`. Permita somente os e-mails que usarão o Sigma.
2. Copie o **Application Audience (AUD)** da aplicação para
   `SIGMA_ACCESS_AUD` e o domínio da equipe para `SIGMA_ACCESS_ISSUER`, no
   formato `https://EQUIPE.cloudflareaccess.com`.
3. Crie um Tunnel dedicado, por exemplo `sigma-oci`, e guarde seu token em
   `CF_TUNNEL_TOKEN`. A pipeline executa o conector Docker na nova OCI.
4. A rota pública do hostname deve apontar para **`http://web:3000`**.
   O serviço `web` e o conector ficam na mesma rede Docker. A rota gerenciada
   pelo painel normalmente cria o CNAME; não use o IP público da VPS como
   destino DNS da aplicação.
5. Mantenha as regras WAF disponíveis no plano e evite cache no hostname.
   Verifique o login do Access em janela anônima antes de usar a base real.

## GitHub Actions → OCI

No repositório `ricardohsousa/google-maps-sigma-scrapper`, configure o
environment **`oci`** com estes Secrets:

| Secret | Valor |
|---|---|
| `OCI_HOST` | IP ou hostname da nova VPS |
| `OCI_USER` | Usuário SSH |
| `OCI_PORT` | Opcional; padrão 22 |
| `OCI_SSH_KEY` | Chave privada de deploy, com as quebras de linha |
| `OCI_KNOWN_HOSTS` | Chave(s) do servidor verificadas pelo console da OCI |
| `CF_TUNNEL_TOKEN` | Token do Tunnel dedicado |
| `SIGMA_OWNER_EMAIL` | E-mail do proprietário inicial |
| `SIGMA_ACCESS_ISSUER` | Domínio HTTPS da equipe Access |
| `SIGMA_ACCESS_AUD` | AUD da aplicação Access |

O workflow assume ARM64. Se `uname -m` na OCI retornar `x86_64`, configure
a variável de **repositório** `OCI_ARCH=amd64`; para `aarch64`, use o padrão
`arm64`. A arquitetura é conferida novamente na VPS antes de alterar a stack.
As variáveis `SIGMA_CPUS` e `SIGMA_MEMORY` podem ser configuradas no
environment; os padrões para a VPS de 1 vCPU/6 GB são 1 CPU e 3 GiB para o
Sigma, além de 256 MiB para o conector.

A pipeline roda em push na `main` ou manualmente em **Actions → Deploy
Sigma OCI**. Executa testes, constrói a imagem no GitHub, publica no GHCR,
verifica a inicialização e a rejeição de acesso anônimo, e só então faz
deploy por SSH. O digest da imagem aprovada é usado no deploy.

A primeira execução instala Docker/Compose em Ubuntu/Debian se necessário.
O usuário SSH precisa ser root ou ter `sudo -n` disponível para isso. A porta
SSH deve estar acessível ao runner; o Tunnel usa saída para a Cloudflare,
incluindo 7844 TCP/UDP. A pipeline não modifica regras da OCI ou firewall.

Na VPS, as releases ficam em `~/sigma-web/releases`, a ativa em
`~/sigma-web/current` e o token em `~/sigma-web/secrets` (diretório 0700).
O volume **`sigma-web_profile`** persiste dados, usuários, acompanhamentos,
auditoria e backups de migração. A stack antiga `sigma` e seu volume não
são apagados. Não use `down -v` para atualizar.

Se a inicialização ou a conexão do conector falhar, o deploy tenta restaurar
a release anterior. Isso não desfaz alterações de dados feitas pelo app.
Nenhuma imagem ou volume é removido automaticamente.

## Preservar e importar os dados locais

**Não é necessário apagar nem substituir a instalação atual.** No desktop
atualizado com este código, abra **Configurações → Backup e migração →
Exportar backup dos dados** e salve o JSON fora da pasta do perfil.

O arquivo contém a base de leads, extrações, grupos, histórico e análises do
localStorage, análises/grupos do serviço de scoring, Kanban e histórico de
campanhas. Não transporta credenciais, chaves de API, sessões WhatsApp,
capturas de tela ou outros arquivos de mídia. Para conservar também esses
arquivos, mantenha uma cópia integral do perfil local.

Na versão web, entre como proprietário e abra **Backup e migração**:

1. Selecione o JSON. O servidor confere o checksum e apresenta uma prévia.
2. Revise as quantidades e escolha **Importar preservando os dados existentes**.
3. Confira base, análises, grupos e etapas do Kanban. Em IDs já existentes,
   o registro do servidor é preservado; conflitos ficam contabilizados.
4. Reimportar o mesmo arquivo não duplica IDs. O arquivo recebido e uma
   cópia do estado anterior ficam em `/data/migration-backups/`.

Anotações/status feitos na versão web também entram em seus backups. A
instalação local permanece independente; não há sincronização bidirecional
automática depois da migração.

Alternativa para uma instalação de desenvolvimento, com o Electron
disponível na máquina: exportar a partir de uma cópia do perfil, sem iniciar
o app principal:

```bash
npx electron scripts/export-profile-backup.js --profile /CAMINHO/DO/PERFIL --output /CAMINHO/FORA/DO/PERFIL/sigma-backup.json
```

O script abre uma cópia temporária para ler o localStorage. Requer uma sessão
gráfica ou display virtual e não pode rodar onde o sistema bloqueia o
Chromium/Electron. Antes de copiar manualmente um perfil, feche o app para
obter uma cópia consistente dos bancos de dados locais.

Nesta preparação, foi conservada uma cópia do perfil Linux em
`.local-backups/sigma-20261103T205728Z/profile`, com um manifesto de checksums.
Essa pasta não entra no Git nem na imagem Docker. A cópia inclui o
localStorage bruto, 1.623 análises e 1.284 cards, mas não substitui a exportação
portátil e a validação final da base. Não houve importação em uma VPS.

## Operação e limites atuais

- Os dados compartilhados ficam no servidor. A ponte mantém apenas uma
  visão em memória na aba para compatibilidade com as telas existentes.
  Escritas usam revisão para impedir sobrescrita silenciosa entre sessões.
- Extrações e análises iniciadas são executadas no backend; fechar a aba
  não apaga os resultados. Não há retomada garantida de tarefas em execução
  após um reboot. Lotes ainda não iniciados pela interface não são uma fila
  persistente no servidor.
- WhatsApp/campanhas seguem desativados pela configuração atual do produto.
  A versão web preserva e importa o histórico comercial, mas não implementa
  conexão/envio de mensagens. A integração de mídia e sessões exige trabalho
  específico antes de reativar essa função na versão web.
- A versão web usa uma única instância do backend com persistência JSON,
  como os serviços locais existentes. Não execute réplicas concorrentes
  sobre o mesmo volume.
- O healthcheck não comprova as políticas do Access. Depois da publicação,
  teste um proprietário, um operador e um e-mail não cadastrado, inclusive
  tentativas de escrita proibida e reconexão após expiração do login.

Na VPS:

```bash
cd ~/sigma-web/current
sudo docker compose -p sigma-web ps
sudo docker compose -p sigma-web logs --tail=100 web cloudflared
```

Para desenvolvimento com Node 22, copie `.env.example` para `.env`, preencha
os campos, exporte as variáveis para o processo e execute `npm run
build:renderer` e `npm run start:web`. A autenticação continua obrigatória.

Referências:
[validação do JWT Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[tokens do Tunnel](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/),
[firewall e Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).
