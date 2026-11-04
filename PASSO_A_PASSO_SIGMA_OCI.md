# Publicar o Sigma na OCI: manual completo

Este é o roteiro principal para publicar **a versão web do Sigma**, com
Cloudflare Access, perfis Proprietário/Operador e importação da base local.
Siga as etapas na ordem. O conteúdo corresponde aos arquivos atuais deste
checkout, especialmente `.github/workflows/deploy-oci.yml` e `deploy/web/`.

**Não coloque chaves privadas, tokens ou senhas neste documento.** Os valores
sensíveis serão cadastrados diretamente nos Secrets do GitHub.

## Índice

1. [Onde estamos e o que falta](#1-onde-estamos-e-o-que-falta)
2. [Como identificar onde executar cada instrução](#2-como-identificar-onde-executar-cada-instrução)
3. [Proteger a base local](#3-proteger-a-base-local)
4. [Conferir a VPS e o SSH](#4-conferir-a-vps-e-o-ssh)
5. [Conferir rede e portas de saída](#5-conferir-rede-e-portas-de-saída)
6. [Preparar a chave SSH da pipeline](#6-preparar-a-chave-ssh-da-pipeline)
7. [Criar o login no Cloudflare Access](#7-criar-o-login-no-cloudflare-access)
8. [Criar o Tunnel e obter o token Docker](#8-criar-o-tunnel-e-obter-o-token-docker)
9. [Preparar o GitHub e cadastrar os Secrets](#9-preparar-o-github-e-cadastrar-os-secrets)
10. [Configurar arquitetura e recursos](#10-configurar-arquitetura-e-recursos)
11. [Publicar o código no GitHub](#11-publicar-o-código-no-github)
12. [Executar e acompanhar o deploy](#12-executar-e-acompanhar-o-deploy)
13. [Concluir a rota, DNS e proteção](#13-concluir-a-rota-dns-e-proteção)
14. [Verificar o primeiro acesso](#14-verificar-o-primeiro-acesso)
15. [Exportar e importar a base local](#15-exportar-e-importar-a-base-local)
16. [Cadastrar e testar o operador](#16-cadastrar-e-testar-o-operador)
17. [Atualizações, backups e reinício](#17-atualizações-backups-e-reinício)
18. [Resolver problemas](#18-resolver-problemas)
19. [Checklist final](#19-checklist-final)

## 1. Onde estamos e o que falta

### O que já foi confirmado nesta conversa

| Item | Situação confirmada |
|---|---|
| Nova VPS | Provisionada, informada como 1 vCPU e 6 GB de RAM |
| Hostname mostrado no terminal | `rh-tech` |
| Usuário SSH | `ubuntu`; a conexão já funcionou |
| Entrada na OCI | TCP 22 permitido a partir de `0.0.0.0/0` |
| Saída na OCI | Todos os protocolos para `0.0.0.0/0` |
| UFW | Não está instalado; não precisa instalá-lo para seguir este roteiro |
| HTTPS para GHCR | Respondeu `HTTP/2 405`; a conexão HTTPS funcionou |
| TCP 7844 / região 1 | `succeeded` |
| TCP 7844 / região 2 | `succeeded` |
| Reserva do perfil local | Cópia de aproximadamente 31 MB e 141 arquivos |
| Dados identificados na reserva | 1.623 análises e 1.284 cards do Kanban |

O `405` apareceu porque foi usado `curl -I`, que envia uma requisição HEAD.
Ele não indica bloqueio da porta 443. Uma resposta HTTP demonstra que o
servidor remoto foi alcançado; a resposta pode variar conforme o método.

### O que ainda precisa ser confirmado/concluído

- [ ] Sistema/versão e arquitetura da nova VPS.
- [ ] Chave SSH exclusiva da pipeline, funcionando sem interação.
- [ ] Arquivo `known_hosts` verificado para essa VPS.
- [ ] Aplicação Access `Sigma`, seu domínio de equipe e seu AUD.
- [ ] Tunnel `sigma-oci`, criado, com token obtido pela opção Docker.
- [ ] Environment `oci` e todos os Secrets no GitHub.
- [ ] Variável de repositório `OCI_ARCH`.
- [ ] Fontes e workflow publicados no GitHub.
- [ ] Pipeline concluída e Tunnel conectado.
- [ ] Rota `sigma.ricardohenrique.com` apontando para `http://web:3000`.
- [ ] Login do proprietário validado.
- [ ] Backup portátil exportado e importação conferida.
- [ ] Operador cadastrado e testado.

**Seu ponto de retomada:** a rede de saída IPv4/TCP já passou nos testes.
Confira a chave da pipeline na etapa 6, configure o Access na etapa 7 e
conclua o Tunnel na etapa 8. Depois faça a configuração do GitHub.

### O que cada componente faz

```text
Publicação:
Computador → GitHub Actions → imagem no GHCR → deploy por SSH na OCI

Acesso ao sistema:
Navegador → Cloudflare Access / WAF → Tunnel → Sigma web na OCI
```

| Componente | Responsabilidade |
|---|---|
| OCI | Hospedar os containers e os dados |
| GitHub Actions | Testar, construir a imagem e executar o deploy |
| GHCR | Guardar a imagem Docker construída |
| Cloudflare Tunnel | Conectar a aplicação à Cloudflare usando conexões de saída |
| Cloudflare Access | Fazer o login e permitir a entrada dos e-mails autorizados |
| WAF | Filtrar requisições maliciosas |
| Sigma | Aplicar as permissões de Proprietário e Operador |

O build será feito no GitHub, não na VPS de 1 vCPU.

## 2. Como identificar onde executar cada instrução

Este manual usa quatro locais diferentes:

| Identificação | Onde fazer |
|---|---|
| **COMPUTADOR** | Terminal do seu Linux, fora da sessão SSH |
| **VPS** | Terminal conectado à OCI por SSH, como `ubuntu@rh-tech` |
| **CLOUDFLARE** | Navegador, painel da conta onde está `ricardohenrique.com` |
| **GITHUB** | Navegador, repositório `ricardohsousa/google-maps-sigma-scrapper` |

O prompt abaixo indica que você está na VPS:

```text
ubuntu@rh-tech:~$
```

Para sair da VPS e voltar ao terminal local:

```bash
exit
```

### Valores que precisam ser substituídos nos comandos

| Exemplo no manual | Substituir por |
|---|---|
| `IP_DA_VPS` | IP público da nova OCI |
| `SUA_CHAVE_DE_PROVISIONAMENTO` | Caminho/nome da chave que já permite entrar na OCI |
| `NOME_DA_EQUIPE` | Nome da equipe Zero Trust que aparece no domínio `cloudflareaccess.com` |
| `seu-email@example.com` | E-mail usado pelo proprietário |

O caminho do projeto no computador desta conversa é:

```text
/home/ricardohenrique/Documentos/Projetos/rhtech/google-maps-sigma-scrapper
```

Não execute literalmente um comando que ainda contém `IP_DA_VPS` ou um nome
de chave de exemplo. Substitua esses valores primeiro.

## 3. Proteger a base local

**Onde: COMPUTADOR.**

Já existe uma cópia do perfil em:

```text
google-maps-sigma-scrapper/.local-backups/sigma-20261103T205728Z/
├── profile/
└── manifest-sha256.json
```

Ela inclui o armazenamento local bruto e os arquivos comerciais identificados.
O manifesto registra os checksums dos 141 arquivos copiados.

Guarde uma segunda cópia fora do repositório:

```bash
cd /home/ricardohenrique/Documentos/Projetos/rhtech/google-maps-sigma-scrapper

mkdir -p "$HOME/Documentos/Backups/Sigma"

cp -a \
  .local-backups/sigma-20261103T205728Z \
  "$HOME/Documentos/Backups/Sigma/"
```

Resultado esperado: uma pasta `sigma-20261103T205728Z` dentro de
`Documentos/Backups/Sigma`.

**Atenção à diferença:** essa pasta é a reserva integral do perfil. Ela
não é o arquivo JSON portátil que você selecionará no navegador. A
exportação desse JSON está na etapa 15.

Se houve novas coletas depois dessa cópia, exporte a base atual também.
Para novas cópias manuais integrais do perfil, feche o Sigma antes de copiar
para obter uma cópia consistente dos bancos locais.

A pasta `.local-backups` é ignorada pelo Git e pelo Docker. Backups integrais
podem conter sessões e configurações privadas: mantenha-os em local privado.

**Concluído quando:** você tem a reserva do perfil fora do projeto e mantém
a instalação local disponível.

## 4. Conferir a VPS e o SSH

### 4.1. Entrar na máquina

**Onde: COMPUTADOR.**

Se a chave privada estiver com permissão aberta, ajuste:

```bash
chmod 600 "$HOME/.ssh/SUA_CHAVE_DE_PROVISIONAMENTO"
```

Conecte:

```bash
ssh \
  -o IdentitiesOnly=yes \
  -i "$HOME/.ssh/SUA_CHAVE_DE_PROVISIONAMENTO" \
  ubuntu@IP_DA_VPS
```

Você já conseguiu conectar nesta conversa. Esta subseção fica como referência
para as próximas conexões.

### 4.2. Conferir sistema, arquitetura e recursos

**Onde: VPS.**

```bash
cat /etc/os-release
uname -m
free -h
df -h /
sudo -n true
```

| Verificação | Resultado esperado |
|---|---|
| Sistema | Ubuntu/Debian, compatível com o instalador atual |
| Arquitetura | `aarch64` ou `x86_64` |
| Memória | Aproximadamente a capacidade de 6 GB informada |
| Disco | Espaço para imagem, dados e backups; observar o espaço disponível |
| `sudo -n true` | Termina sem erro e normalmente sem saída |

Anote a arquitetura:

| `uname -m` | Valor de `OCI_ARCH` no GitHub |
|---|---|
| `aarch64` | `arm64` |
| `x86_64` | `amd64` |

Se `sudo -n true` disser que precisa de senha, a pipeline não conseguirá
usar sudo de forma não interativa. Resolva o acesso administrativo do usuário
antes do primeiro deploy. O usuário `ubuntu` das imagens cloud normalmente
já tem esse acesso; o comando é a confirmação.

Se a imagem for Oracle Linux, este instalador automático por `apt` não atende
ao primeiro provisionamento. Será necessário adequar a instalação do Docker
a essa distribuição antes de seguir com a automação atual.

**Não é necessário instalar Node.js, Electron ou Playwright na VPS.** A
pipeline constrói e envia a imagem pronta. Docker/Compose são instalados
automaticamente no primeiro deploy quando estão ausentes e o SO é compatível.

## 5. Conferir rede e portas de saída

**Esta etapa já passou nos testes TCP realizados por você.** Use os comandos
abaixo para referência ou se houver mudança na rede.

### 5.1. Regras na OCI

**Onde: PAINEL OCI.**

Na instância, identifique a VNIC, a subnet e eventuais NSGs associados.
Confira as Security Lists da subnet e as regras dos NSGs aplicáveis.

Você mostrou estas regras:

| Direção | Regra existente | Situação |
|---|---|---|
| Ingress | TCP 22, origem `0.0.0.0/0` | Permite SSH do computador e do runner |
| Egress | Todos os protocolos, destino `0.0.0.0/0` | Já cobre as saídas IPv4 necessárias |

Com essa saída existente, **não precisa adicionar outras regras de Egress**
para o procedimento atual.

Se futuramente restringir a saída, considere estas conexões:

| Protocolo | Porta de destino | Finalidade |
|---|---:|---|
| TCP | 80 | Repositórios HTTP e sites analisados |
| TCP | 443 | GHCR, download de pacotes, APIs e sites |
| TCP | 7844 | Cloudflare Tunnel por HTTP/2 |
| UDP | 7844 | Cloudflare Tunnel por QUIC |
| UDP/TCP | 53 | Consultas ao resolvedor DNS configurado |

Em regras específicas, use porta de origem **All**, porta de destino conforme
a tabela e regra **stateful** (`Stateless` desmarcado). Regras IPv6, se
necessárias, usam os destinos IPv6 correspondentes; os testes abaixo forçam
IPv4 para combinar com a regra que você apresentou.

O Tunnel não exige entrada nas portas 7844, 3000, 5900 ou 6080. O serviço web
é publicado no loopback da VPS; o conector alcança o app pela rede Docker.

O runner padrão do GitHub usa IP de saída variável. A entrada SSH precisa
permitir que ele conecte. Sua regra atual de TCP 22 atende a isso. Se depois
restringir o SSH ao seu IP pessoal, a pipeline precisará de um runner com
saída permitida ou de uma solução de conectividade equivalente.

Referência: [portas e destinos do Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).

### 5.2. Firewall dentro do Ubuntu

**Onde: VPS.**

```bash
sudo ufw status verbose
```

No seu caso, apareceu:

```text
sudo: 'ufw': command not found
```

Isso significa que o UFW não está instalado. Não precisa instalá-lo para
seguir. Outros mecanismos de firewall podem existir; os testes de conexão
confirmam o tráfego efetivamente permitido.

### 5.3. Ferramentas de teste

**Onde: VPS.**

```bash
sudo apt-get update

sudo apt-get install -y curl ca-certificates dnsutils netcat-openbsd
```

Se `apt-get update` falhar, confira a mensagem de DNS/rota/timeout antes de
tentar instalar mais componentes.

### 5.4. DNS

```bash
getent ahostsv4 ghcr.io
getent ahostsv4 region1.v2.argotunnel.com
getent ahostsv4 region2.v2.argotunnel.com
```

Resultado esperado: endereços IP. Para mais detalhes:

```bash
dig +time=3 +tries=1 region1.v2.argotunnel.com A
resolvectl status
```

### 5.5. HTTPS

```bash
curl -4 -I --connect-timeout 5 --max-time 15 https://ghcr.io/v2/
```

Você recebeu `HTTP/2 405`. Isso confirmou a conexão HTTPS. A resposta de
autenticação/método pode variar; tanto um `401` como o `405` observado
mostram que houve resposta do serviço remoto.

Mais testes, se necessário:

```bash
curl -4 -I --connect-timeout 5 --max-time 15 https://github.com
curl -4 -I --connect-timeout 5 --max-time 15 https://download.docker.com/linux/ubuntu/gpg
```

### 5.6. TCP 7844

```bash
nc -4 -vz -w 5 region1.v2.argotunnel.com 7844
nc -4 -vz -w 5 region2.v2.argotunnel.com 7844
```

Os dois já retornaram `succeeded` para você.

Isso confirma TCP para os endereços testados. A saída UDP será comprovada
quando o conector registrar uma conexão com `protocol=quic`. Um teste
isolado com `nc -u` não comprova uma negociação QUIC bem-sucedida.

## 6. Preparar a chave SSH da pipeline

Esta etapa é diferente de conseguir entrar manualmente na VPS. A pipeline
precisa de uma chave privada disponível no GitHub, sem solicitar senha ou
depender do agente SSH/1Password do seu computador.

### 6.1. Criar uma chave exclusiva

**Onde: COMPUTADOR.** Saia da sessão SSH antes de executar.

```bash
ssh-keygen \
  -t ed25519 \
  -C "sigma-github-actions" \
  -f "$HOME/.ssh/sigma_oci_deploy" \
  -N ""
```

`-N ""` cria a chave sem passphrase, para permitir uso não interativo pelo
runner. A chave privada será protegida como Secret no GitHub.

Se o arquivo já existir, preserve-o ou escolha outro nome; não substitua
uma chave que ainda está em uso.

Serão criados:

| Arquivo | Destino/finalidade |
|---|---|
| `~/.ssh/sigma_oci_deploy` | Privada: Secret `OCI_SSH_KEY` |
| `~/.ssh/sigma_oci_deploy.pub` | Pública: `authorized_keys` do usuário na VPS |

### 6.2. Autorizar a chave pública na VPS

**Onde: COMPUTADOR.** Substitua a chave de provisionamento e o IP:

```bash
cat "$HOME/.ssh/sigma_oci_deploy.pub" |
ssh \
  -o IdentitiesOnly=yes \
  -i "$HOME/.ssh/SUA_CHAVE_DE_PROVISIONAMENTO" \
  ubuntu@IP_DA_VPS \
  'umask 077
mkdir -p ~/.ssh
cat >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys'
```

Esse comando acrescenta a nova chave pública sem substituir as existentes.

### 6.3. Testar exatamente a chave nova

```bash
ssh \
  -o IdentityAgent=none \
  -o IdentitiesOnly=yes \
  -i "$HOME/.ssh/sigma_oci_deploy" \
  ubuntu@IP_DA_VPS
```

Na VPS:

```bash
whoami
sudo -n true
```

Resultado esperado: usuário `ubuntu` e sudo sem erro. Volte ao computador:

```bash
exit
```

### 6.4. Preparar e verificar o `known_hosts`

A chave de host identifica **o servidor**. Ela é diferente da chave que
identifica o usuário SSH.

**Onde: VPS, por uma conexão já confiável ou console da OCI.**

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Anote a impressão digital `SHA256:...`.

**Onde: COMPUTADOR.**

```bash
ssh-keyscan -t ed25519 IP_DA_VPS > "$HOME/.ssh/sigma_oci_known_hosts"

ssh-keygen -lf "$HOME/.ssh/sigma_oci_known_hosts"
```

A impressão digital deve ser igual à conferida na VPS/console. O
`ssh-keyscan` coleta uma chave, mas não estabelece sozinho que ela pertence
à sua máquina; a comparação é o passo de verificação.

O arquivo `~/.ssh/sigma_oci_known_hosts` será copiado para o Secret
`OCI_KNOWN_HOSTS`. A pipeline exige essa verificação.

Para porta SSH diferente de 22, use `ssh-keyscan -p PORTA` e cadastre a mesma
porta em `OCI_PORT`. O host no arquivo deverá estar no formato `[HOST]:PORTA`.

**Concluído quando:** a chave exclusiva conecta sem agente/passphrase,
sudo funciona e o arquivo `known_hosts` foi verificado.

## 7. Criar o login no Cloudflare Access

**Onde: CLOUDFLARE.** Use a conta que contém `ricardohenrique.com`.

O Access é responsável pelo login. O proprietário e o operador não precisam
ser administradores da conta Cloudflare.

### 7.1. Identificar a equipe Zero Trust

Abra o Zero Trust da sua conta. Se a configuração inicial ainda não foi
concluída, configure a equipe e anote seu domínio:

```text
https://NOME_DA_EQUIPE.cloudflareaccess.com
```

Esse endereço completo será o Secret `SIGMA_ACCESS_ISSUER`.

Ele não é `sigma.ricardohenrique.com`, não é o endereço do painel Cloudflare
e não é o ID da conta.

### 7.2. Configurar o método de login

Para começar com código enviado por e-mail, configure **One-time PIN**
entre os provedores de identidade/métodos de login do Zero Trust.
Na interface, procure a área **Integrations / Identity providers**.

Se já usa outro provedor de login, pode selecioná-lo na aplicação, desde
que a identidade entregue contenha o e-mail autorizado.

Referência: [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

### 7.3. Criar a aplicação Sigma

Abra **Access controls → Applications → Add an application** e escolha
**Self-hosted**. Alguns nomes de menus podem aparecer traduzidos.

Preencha:

| Campo | Valor |
|---|---|
| Nome | `Sigma` |
| Hostname público | `sigma.ricardohenrique.com` |
| Subdomínio, se separado | `sigma` |
| Domínio, se separado | `ricardohenrique.com` |
| Caminho | Em branco, cobrindo todos os caminhos |
| Método de login | O método configurado, por exemplo One-time PIN |

Crie uma política:

| Campo | Valor |
|---|---|
| Nome da política | `Acesso Sigma` |
| Ação | `Allow` |
| Regra Include | `Emails` |
| Valor inicial | E-mail do proprietário |

Use e-mails explícitos. Não configure `Bypass` ou uma regra `Everyone`
para abrir o aplicativo sem o controle definido.

Salve a aplicação e a política.

### 7.4. Copiar o AUD

Abra os detalhes/configurações da aplicação criada e copie o campo
**Application Audience / AUD**. Ele será o Secret `SIGMA_ACCESS_AUD`.

| Valor | De onde vem | Onde será usado |
|---|---|---|
| E-mail do proprietário | E-mail incluído na política Allow | `SIGMA_OWNER_EMAIL` |
| Domínio da equipe | `https://EQUIPE.cloudflareaccess.com` | `SIGMA_ACCESS_ISSUER` |
| AUD | Aplicação Access `Sigma` | `SIGMA_ACCESS_AUD` |

O backend confere assinatura, emissor, audiência e validade do token. Um
AUD de outra aplicação não é aceito.

Referências: [aplicação Self-hosted](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[validação do token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

**Concluído quando:** a aplicação cobre o hostname inteiro, permite seu
e-mail e você tem os três valores acima para cadastrar no GitHub.

## 8. Criar o Tunnel e obter o token Docker

**Onde: CLOUDFLARE.**

### 8.1. Criar o Tunnel

Abra **Networking → Tunnels → Create Tunnel** e use o nome:

```text
sigma-oci
```

Se aparecer uma escolha de conector, use **Cloudflared**.

### 8.2. Escolher Docker

Na etapa de instalação/configuração do conector, escolha **Docker**.

O sistema operacional da VPS pode ser Ubuntu: aqui a escolha Docker
corresponde à forma como o conector será executado pela pipeline.

O painel deve mostrar um comando parecido com:

```text
docker run cloudflare/cloudflared:... tunnel ... run --token TOKEN_DO_TUNNEL
```

Copie **somente o valor depois de `--token`**. Não copie o comando inteiro,
o nome da imagem ou aspas que apenas envolvem o token no comando.

O valor será cadastrado no Secret **`CF_TUNNEL_TOKEN`** do GitHub.

O token pertence ao Tunnel. A seleção Docker/Debian muda as instruções de
instalação, não cria identidades diferentes para esse mesmo Tunnel.

**Não execute outro comando de instalação do conector na VPS para este
procedimento.** A pipeline já inicia o container `cloudflared` com o token.

### 8.3. Estado Offline antes do deploy

É esperado que o Tunnel fique **Offline** enquanto o conector ainda não
foi iniciado. Criar o Tunnel no painel não instala nada na VPS.

Se o painel exigir conexão antes de avançar para a rota:

1. Guarde o token nos Secrets conforme a etapa 9.
2. Conclua a publicação e execute a pipeline.
3. Volte à etapa 13 para cadastrar a rota depois que o conector conectar.

Não é necessário instalar um conector temporário para contornar essa etapa.

Referências: [criação do Tunnel](https://developers.cloudflare.com/tunnel/get-started/),
[token do conector](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/).

**Concluído quando:** o Tunnel existe e o token correto está disponível
para cadastrar como Secret. A conexão será confirmada depois do deploy.

## 9. Preparar o GitHub e cadastrar os Secrets

**Onde: GITHUB.**

Repositório:

```text
https://github.com/ricardohsousa/google-maps-sigma-scrapper
```

### 9.1. Criar o environment

Abra:

```text
Settings → Environments → New environment
```

Nome exato usado pela pipeline:

```text
oci
```

Crie/configure esse environment. Em repositórios privados, confirme que
seu plano GitHub oferece suporte ao recurso. Se a opção não aparecer, isso
precisa ser resolvido ou a configuração do job precisa ser adaptada antes
de usar este roteiro de environment.

### 9.2. Cadastrar cada Secret

Dentro do environment `oci`, use **Add environment secret** para cada linha:

| Nome exato | Valor a cadastrar | Origem |
|---|---|---|
| `OCI_HOST` | IP público da nova VPS, sem `ubuntu@`, sem protocolo | Painel OCI |
| `OCI_USER` | `ubuntu` | Usuário SSH já testado |
| `OCI_PORT` | `22`; pode omitir se usar essa porta | Configuração SSH |
| `OCI_SSH_KEY` | Conteúdo integral da chave privada, sem passphrase | `~/.ssh/sigma_oci_deploy` |
| `OCI_KNOWN_HOSTS` | Conteúdo integral do arquivo verificado | `~/.ssh/sigma_oci_known_hosts` |
| `CF_TUNNEL_TOKEN` | Somente o token, sem `docker run ...` | Tunnel `sigma-oci`, opção Docker |
| `SIGMA_OWNER_EMAIL` | E-mail do proprietário permitido no Access | Etapa 7 |
| `SIGMA_ACCESS_ISSUER` | `https://NOME_DA_EQUIPE.cloudflareaccess.com` | Equipe Zero Trust |
| `SIGMA_ACCESS_AUD` | AUD da aplicação `Sigma` | Aplicação Access |

Na chave privada, preserve as quebras de linha e as linhas de início/fim:

```text
-----BEGIN OPENSSH PRIVATE KEY-----
CONTEUDO_DA_CHAVE
-----END OPENSSH PRIVATE KEY-----
```

Não use o arquivo `.pub` em `OCI_SSH_KEY`. Ele contém a chave pública,
que já foi cadastrada no servidor.

Para `OCI_KNOWN_HOSTS`, copie a linha completa que inclui o host, o tipo de
chave e o conteúdo da chave. Não cadastre apenas a impressão digital SHA256.

### 9.3. Valores que não precisa criar

Não precisa criar manualmente `GITHUB_TOKEN`, `REGISTRY_TOKEN` ou um PAT
para este fluxo. O workflow usa o `GITHUB_TOKEN` fornecido pelo GitHub
para publicar/baixar a imagem no GHCR.

Se já existir um pacote com o mesmo nome, confira em suas configurações
**Manage Actions access** se este repositório pode acessar o pacote.

Referência: [environments do GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

**Concluído quando:** todos os Secrets obrigatórios estão no environment
`oci` e você conferiu a origem de cada valor.

## 10. Configurar arquitetura e recursos

**Onde: GITHUB.**

### 10.1. Arquitetura: variável de repositório

Abra:

```text
Settings → Secrets and variables → Actions → Variables → New repository variable
```

Cadastre:

| Nome | Valor |
|---|---|
| `OCI_ARCH` | `arm64` para `aarch64`, ou `amd64` para `x86_64` |

**Essa variável precisa ser do repositório**, porque o job de build a usa
antes do job associado ao environment `oci`. Se não for configurada,
o workflow assume `arm64`.

### 10.2. Limites de recursos: opcionais

Você pode cadastrar estas variables no environment `oci`:

| Nome | Valor inicial para a VPS informada |
|---|---|
| `SIGMA_CPUS` | `1.0` |
| `SIGMA_MEMORY` | `3g` |

Esses já são os padrões. O conector tem limite separado de 256 MiB.
Depois de uma extração e análise reais, confira o consumo para ajustar.

**Concluído quando:** `OCI_ARCH` corresponde ao `uname -m` da VPS.

## 11. Publicar o código no GitHub

**Onde: COMPUTADOR.**

Os arquivos já foram criados neste checkout. Você precisa publicar o
conjunto de fontes usado pelo build, não somente o arquivo do workflow.

### 11.1. Validar a aplicação localmente

Use Node 22 para acompanhar o ambiente da pipeline. No projeto:

```bash
cd /home/ricardohenrique/Documentos/Projetos/rhtech/google-maps-sigma-scrapper

node --version
npm ci
npm test
npm run build:renderer
```

Esses comandos instalam dependências, executam os testes e constroem a
interface. Eles não iniciam uma importação da sua base local.

### 11.2. Revisar alterações existentes

```bash
git branch --show-current
git remote -v
git status --short
git diff --stat
git diff --cached --name-status
```

O checkout consultado está na branch `main`, com remoto:

```text
git@github.com:ricardohsousa/google-maps-sigma-scrapper.git
```

Há alterações anteriores a esta implementação, inclusive exclusões que já
estavam no staging. Revise-as antes do commit. O próximo commit inclui
também o que já estava preparado no índice.

Se uma alteração não deve fazer parte do commit, retire somente esse caminho
do staging, preservando os arquivos de trabalho:

```bash
git restore --staged CAMINHO_DO_ARQUIVO
```

### 11.3. Preparar os arquivos necessários

```bash
git add \
  .github \
  .dockerignore \
  .gitignore \
  deploy \
  server \
  renderer \
  utils \
  lead-scoring \
  kanban \
  test \
  docs \
  scripts/export-profile-backup.js

git add \
  main.js \
  preload.js \
  scraper.js \
  places-api.js \
  config.js \
  package.json \
  package-lock.json \
  vite.config.js \
  README.md \
  PASSO_A_PASSO_SIGMA_OCI.md
```

Alguns arquivos utilizados pelo código atual, como `places-api.js` e
`utils/maps-settings.js`, ainda estavam sem rastreamento. Eles precisam
estar presentes no checkout que o GitHub construirá.

Confira:

```bash
git diff --cached --stat
git diff --cached
git diff --check
```

Não devem aparecer backups, chaves privadas ou arquivos `.env` preenchidos.
Os diretórios de dados e de segredos estão no `.gitignore`.

### 11.4. Commit e push

Com a revisão concluída e os Secrets já cadastrados:

```bash
git commit -m "feat: Sigma web com Access, perfis e migracao"
git push origin main
```

O push em `main` dispara a pipeline automaticamente. Alterações apenas em
Markdown ou `docs/` não disparam o workflow atual; para esses casos, existe
a execução manual na próxima etapa.

Se o push for rejeitado porque o remoto avançou, concilie as alterações da
branch antes de publicar. Não substitua o histórico remoto para contornar
essa divergência.

**Concluído quando:** o GitHub mostra o workflow e os fontes atuais na branch
`main`, sem dados privados no commit.

## 12. Executar e acompanhar o deploy

**Onde: GITHUB.**

Abra:

```text
Actions → Deploy Sigma OCI
```

Se o push já iniciou uma execução, acompanhe-a. Para iniciar manualmente:

```text
Run workflow → Branch: main → Run workflow
```

### O que cada job faz

| Job | O que acontece |
|---|---|
| `Build e smoke test` | Instala dependências de teste, valida os scripts, executa testes, constrói a imagem e publica no GHCR |
| Teste da imagem | Inicia um container de teste e verifica servidor saudável e rejeição de acesso sem identidade |
| `Publicar na OCI` | Transfere a release por SSH, instala Docker/Compose quando necessário, baixa a imagem testada e inicia a stack |

A imagem do Sigma fica com nome semelhante a:

```text
ghcr.io/ricardohsousa/google-maps-sigma-scrapper/sigma-web:COMMIT
```

O deploy usa o digest da imagem testada. O primeiro build pode demorar por
causa dos downloads e da instalação do navegador de scraping.

### O que será criado na VPS

```text
~/sigma-web/
├── releases/             # manifests e configuração de cada deploy
├── current -> releases/ID_DA_RELEASE
└── secrets/
    └── tunnel-token
```

| Recurso | Nome/endereço |
|---|---|
| Projeto Compose | `sigma-web` |
| Serviço da aplicação | `web` |
| Serviço do Tunnel | `cloudflared` |
| Volume persistente | `sigma-web_profile` |
| Saúde no host | `http://127.0.0.1:3000/healthz` |
| Destino do Tunnel | `http://web:3000` |
| Endpoint interno do conector | `http://cloudflared:2000/ready` |

A pipeline confirma a saúde do serviço e a conexão do conector. Em uma
falha de atualização, tenta restaurar a release anterior. O primeiro deploy
não tem uma release anterior disponível.

### Quando esta etapa está concluída

- [ ] Job de build/testes ficou verde.
- [ ] Job de deploy ficou verde.
- [ ] O conector aparece conectado no painel Cloudflare.

Um deploy verde ainda não comprova o DNS público ou a política de acesso.
Essas verificações estão nas etapas 13 e 14.

## 13. Concluir a rota, DNS e proteção

**Onde: CLOUDFLARE.** Faça isso com a aplicação Access da etapa 7 já criada.

### 13.1. Rota pública

Abra o Tunnel `sigma-oci` e procure:

```text
Routes → Add route → Published application
```

Em versões da interface, essa área pode aparecer como rotas de aplicações
publicadas ou hostname público. Preencha:

| Campo | Valor exato para esta stack |
|---|---|
| Subdomínio | `sigma` |
| Domínio | `ricardohenrique.com` |
| Caminho | Em branco |
| Tipo | HTTP |
| Serviço | `web:3000` |
| URL completa do serviço | `http://web:3000` |

**Por que esse endereço?** O conector roda em um container na mesma rede
Docker da aplicação. `web` é o nome do serviço da aplicação nessa rede.
`localhost` dentro do conector apontaria para o próprio conector.

### 13.2. DNS

A criação da rota pelo painel normalmente cria um CNAME para o Tunnel.
Na zona `ricardohenrique.com`, confira um registro para `sigma`, associado
ao destino semelhante a:

```text
UUID_DO_TUNNEL.cfargotunnel.com
```

O registro deve usar o proxy Cloudflare. Se já existe um registro `sigma`
com outro destino, confira o uso dele antes de substituir. A aplicação
não precisa de um registro A apontando diretamente ao IP da VPS.

### 13.3. WAF e cache

Mantenha as regras gerenciadas disponíveis no plano. O Free Managed Ruleset
é aplicado por padrão no plano Free; regras adicionais dependem do plano.

Crie uma regra de cache restrita ao hostname:

```text
sigma.ricardohenrique.com
```

Comportamento: **Bypass cache**. As respostas contêm dados privados e variam
conforme o usuário. Não é necessário alterar o cache do domínio inteiro.

Referências: [rotas do Tunnel](https://developers.cloudflare.com/tunnel/get-started/),
[WAF](https://developers.cloudflare.com/waf/get-started/).

**Concluído quando:** existe uma rota para `http://web:3000`, o DNS está
associado ao Tunnel e o Access cobre o hostname inteiro.

## 14. Verificar o primeiro acesso

### 14.1. Verificação na VPS

**Onde: VPS.**

```bash
cd "$HOME/sigma-web/current"

sudo docker compose -p sigma-web ps

sudo docker compose -p sigma-web logs --tail=100 web cloudflared

curl -fsS http://127.0.0.1:3000/healthz
```

A saúde do app deve retornar:

```json
{"status":"ok"}
```

Nos logs do conector, procure:

```text
Registered tunnel connection
```

| Campo do log | O que confirma |
|---|---|
| `protocol=quic` | Conexão pela saída UDP 7844 |
| `protocol=http2` | Conexão pela saída TCP 7844 |

O modo automático pode recorrer ao HTTP/2 se não estabelecer UDP.

Teste o endpoint interno do conector:

```bash
sudo docker compose -p sigma-web exec -T web \
  node -e "fetch('http://cloudflared:2000/ready',{signal:AbortSignal.timeout(5000)}).then(r=>{console.log('Tunnel readiness:',r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Esperado:

```text
Tunnel readiness: 200
```

| Verificação | Comprova |
|---|---|
| `/healthz` | Sigma rodando |
| `/ready` do conector | Tunnel conectado à Cloudflare |
| Navegação pública | DNS, rota, Access e aplicação funcionando juntos |

Referência: [diagnóstico do conector](https://developers.cloudflare.com/tunnel/troubleshooting/).

### 14.2. Verificação no navegador

**Onde: COMPUTADOR / NAVEGADOR.** Abra uma janela anônima:

```text
https://sigma.ricardohenrique.com
```

Fluxo esperado:

1. Aparece o login do Cloudflare Access.
2. Você informa o e-mail do proprietário.
3. Autentica pelo método escolhido, como código por e-mail.
4. O Sigma abre identificando o usuário como **Proprietário**.

Não precisa criar uma senha local no Sigma.

O e-mail em `SIGMA_OWNER_EMAIL` é usado para criar o proprietário **somente
no primeiro startup de uma base web nova**. Depois disso, o cadastro é
persistido. Alterar apenas esse Secret não transfere automaticamente uma
instalação existente para outro proprietário.

**Concluído quando:** o proprietário entra pelo hostname público e consegue
abrir as telas administrativas.

## 15. Exportar e importar a base local

O deploy começa com uma base web própria. Ele não lê automaticamente o
perfil do seu computador e não copia a reserva local para a VPS.

### 15.1. Exportar pelo desktop atualizado

**Onde: COMPUTADOR.** No checkout atual, depois de instalar as dependências:

```bash
cd /home/ricardohenrique/Documentos/Projetos/rhtech/google-maps-sigma-scrapper
npm start
```

Confira primeiro que a janela aberta mostra a base que você pretende
migrar. Uma instalação de desenvolvimento pode usar um perfil diferente
da aplicação instalada.

Na janela do Sigma:

```text
Configurações → Backup e migração → Exportar backup dos dados
```

Salve fora do perfil, por exemplo:

```text
~/Documentos/Backups/Sigma/sigma-migration.json
```

Se a janela abriu uma base vazia, não use essa exportação como sua migração.
Use a alternativa abaixo para apontar explicitamente para a cópia preservada.

### 15.2. Alternativa: exportar a partir da cópia do perfil

**Onde: COMPUTADOR, em uma sessão gráfica normal.**

```bash
cd /home/ricardohenrique/Documentos/Projetos/rhtech/google-maps-sigma-scrapper

mkdir -p "$HOME/Documentos/Backups/Sigma"

./node_modules/.bin/electron \
  scripts/export-profile-backup.js \
  --profile "$PWD/.local-backups/sigma-20261103T205728Z/profile" \
  --output "$HOME/Documentos/Backups/Sigma/sigma-migration.json"
```

O arquivo de saída não deve existir: o script evita substituí-lo. Se já
existe, confira o backup anterior e escolha um novo nome para a nova cópia.

O script abre uma cópia temporária para recuperar o localStorage. O perfil
fornecido como origem é apenas lido. Essa exportação exige que o sistema
permita iniciar Electron/Chromium.

**Limite já encontrado:** o ambiente usado pelo agente bloqueou a
inicialização do Electron; portanto, a geração desse JSON portátil ainda
precisa ser executada e conferida no computador. A reserva integral de
141 arquivos foi criada e seus checksums foram verificados.

### 15.3. O que o backup portátil contém

| Conteúdo | Incluído no JSON portátil? |
|---|---|
| Leads da base local | Sim, a partir do localStorage do perfil exportado |
| Histórico de extrações | Sim |
| Grupos e histórico comercial local | Sim |
| Análises e grupos de scoring | Sim |
| Kanban | Sim |
| Histórico de campanhas | Sim, quando presente |
| Acompanhamentos criados na versão web | Sim, nos backups exportados pela web |
| Chaves de API e credenciais | Não |
| Sessões/conexões WhatsApp | Não |
| Capturas de tela e arquivos de mídia | Não |

Os arquivos não transportados pelo JSON continuam na reserva integral do
perfil. As integrações precisam ser configuradas novamente na versão web.

### 15.4. Importar na versão web

**Onde: SITE DO SIGMA, como Proprietário.**

1. Abra **Backup e migração**.
2. Selecione o JSON exportado, não a pasta do perfil ou o manifesto.
3. Aguarde a verificação de integridade e a prévia.
4. Confira quantidades de leads, análises, grupos, cards e conflitos.
5. Clique em **Importar preservando os dados existentes**.
6. Aguarde o resultado e confira a base e o Kanban.

O limite de upload atual é de 64 MiB. Se o backup exceder esse tamanho,
será necessário ajustar o fluxo/limite antes da importação; não corte o JSON
manualmente, pois ele possui checksum de integridade.

### 15.5. Como a importação protege os dados

- Mantém os IDs dos registros importados.
- IDs já existentes no servidor são preservados; conflitos são contabilizados.
- Reimportar o mesmo arquivo não duplica os IDs.
- Guarda o backup recebido e o estado anterior em `/data/migration-backups/`.
- Não altera a instalação local que originou a exportação.

Confira uma amostra real: nome, telefone, análise, grupo, anotação e etapa
do card de empresas que você já conhece. A quantidade de cards pode crescer
após a sincronização das diferentes fontes; compare também os registros e
as etapas, não apenas um total agregado.

Depois da migração, desktop e web são bases independentes. Não há
sincronização bidirecional automática.

**Concluído quando:** você conferiu os dados no site, mantém os backups e
definiu a versão web como local de trabalho da operação.

## 16. Cadastrar e testar o operador

### 16.1. Cadastro dentro do Sigma

**Onde: SITE DO SIGMA, como Proprietário.**

Abra **Usuários** e informe:

| Campo | Valor |
|---|---|
| E-mail | E-mail real do operador |
| Perfil | `Operador` |
| Estado | Ativo |

Salve o usuário.

### 16.2. Permitir esse e-mail no Access

**Onde: CLOUDFLARE.**

Edite a aplicação Access `Sigma`, abra a política `Acesso Sigma` e
acrescente o e-mail do operador à regra Allow por e-mail.

As duas autorizações são necessárias:

| Cadastro | Função |
|---|---|
| Política do Access | Permite chegar à aplicação |
| Usuário ativo no Sigma | Define o perfil e as ações permitidas |

Não é necessário convidar o operador para administrar a conta Cloudflare.

### 16.3. Testar em outra sessão

Use outro navegador/perfil para entrar com o e-mail do operador. O esperado:

| Ação | Proprietário | Operador |
|---|---|---|
| Consultar e buscar leads | Sim | Sim |
| Consultar análises existentes e Kanban | Sim | Sim |
| Salvar anotações | Sim | Sim |
| Atualizar status de atendimento | Sim | Sim |
| Mover cards entre etapas existentes | Sim | Sim |
| Extrair/importar novos leads | Sim | Não |
| Editar cadastro ou excluir leads | Sim | Não |
| Exportar a base | Sim | Não |
| Executar análises novas | Sim | Não |
| Configurar etapas, regras ou integrações | Sim | Não |
| Gerenciar usuários | Sim | Não |

As restrições são aplicadas pelo backend, inclusive em chamadas diretas às
APIs. O operador usa a tela **Trabalhar leads**.

Teste também um e-mail que não foi autorizado: ele deve ser bloqueado.

## 17. Atualizações, backups e reinício

### 17.1. Atualizar o código

**Onde: COMPUTADOR.**

```text
Alterar código → executar testes/build → revisar commit → push em main
```

**Onde: GITHUB.** Acompanhe **Deploy Sigma OCI** até ambos os jobs ficarem
verdes. Não é necessário fazer `git pull` na VPS: ela recebe a imagem pronta.

O workflow já usa permissões para GHCR; o token de login no registro é
temporário. A configuração temporária de login é removida ao fim do deploy.

### 17.2. Ver serviços e consumo

**Onde: VPS.**

```bash
cd "$HOME/sigma-web/current"

sudo docker compose -p sigma-web ps
sudo docker compose -p sigma-web logs --tail=100 web cloudflared
sudo docker stats --no-stream
df -h /
```

Para acompanhar logs continuamente:

```bash
sudo docker compose -p sigma-web logs -f --tail=100 web cloudflared
```

Use `Ctrl+C` para sair do acompanhamento. Isso não para os containers.

### 17.3. Reiniciar os serviços existentes

```bash
cd "$HOME/sigma-web/current"
sudo docker compose -p sigma-web restart web cloudflared
```

Se estiverem parados:

```bash
sudo docker compose -p sigma-web start
```

O serviço usa política de reinício automático. Após um reboot da VPS,
o Docker precisa iniciar e os containers devem voltar. Confira o estado.

### 17.4. Baixar backup comercial pelo site

**Onde: SITE DO SIGMA, como Proprietário.**

```text
Backup e migração → Baixar backup
```

Guarde essa cópia fora da VPS. O JSON comercial não substitui um backup
integral do volume com usuários, configurações e demais arquivos.

### 17.5. Copiar integralmente o volume

**Onde: VPS.** Esta operação pausa o app durante a cópia.

```bash
cd "$HOME/sigma-web/current"

SIGMA_BACKUP_DIR="$HOME/sigma-web/backups/$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$SIGMA_BACKUP_DIR"
chmod 700 "$SIGMA_BACKUP_DIR"

sudo docker compose -p sigma-web stop web

sudo docker compose -p sigma-web cp \
  web:/data/. \
  "$SIGMA_BACKUP_DIR/profile"

sudo docker compose -p sigma-web start web
```

Se a cópia falhar, execute mesmo assim o comando `start web` para voltar
o serviço. Confira a saúde depois. Guarde uma cópia externa protegida desse
diretório; somente uma cópia na própria VPS não cobre a perda da máquina.

### 17.6. Persistência e retorno de versão

O volume `sigma-web_profile` persiste usuários, dados, acompanhamentos,
auditoria e backups de migração. Recriar o container preserva esse volume.

**Não execute `docker compose down -v` nem remova o volume para atualizar ou
corrigir um login.** Isso apagaria a persistência.

O retorno automático da pipeline tenta iniciar a imagem/configuração
anterior. Ele não desfaz modificações realizadas nos dados. Faça backup
antes de atualizações que migrem os dados.

Imagens e releases antigas ficam disponíveis e não são limpas automaticamente.
Monitore o espaço em disco para não acumular imagens indefinidamente.

## 18. Resolver problemas

| Sintoma | Causa provável / próxima verificação |
|---|---|
| `UNPROTECTED PRIVATE KEY FILE` | No computador, use `chmod 600` na chave privada correta |
| `Permission denied (publickey)` | Confira usuário, chave privada, chave pública no `authorized_keys` e permissões |
| SSH manual funciona; pipeline não conecta | Verifique se usou a mesma chave testada, se ela não tem passphrase e se o runner alcança TCP 22 |
| SSH timeout | IP público, rota, entrada TCP 22, firewall e origem permitida |
| `Host key verification failed` | Confira `OCI_KNOWN_HOSTS`, IP/hostname, porta e impressão digital verificada |
| `ufw: command not found` | UFW ausente; não é necessário instalá-lo para este procedimento |
| `curl ... ghcr.io` retorna 405/401 | Houve resposta HTTPS; não indica bloqueio de rede |
| `Could not resolve host` / `lookup ... timeout` | DNS; execute `getent`, `dig` e `resolvectl status` |
| Configuração obrigatória ausente | Secret faltando ou cadastrado fora do escopo usado pelo job |
| Deploy termina em 0s com apenas `exit code 1` | Versões anteriores tinham validações sem mensagem. Publique o script `deploy/desktop/deploy-action.sh` atualizado para identificar o campo inválido sem expor valores. Rerun de commit antigo continua usando o código antigo. |
| Pipeline aguarda runner ARM | Confira disponibilidade do runner e se `OCI_ARCH` corresponde à máquina |
| Arquitetura incompatível | `aarch64` usa `arm64`; `x86_64` usa `amd64` |
| Erro de sudo na pipeline | Usuário precisa de acesso administrativo não interativo para instalação/operação do Docker |
| Erro no pull/login do GHCR | Permissões do pacote, vínculo com o repositório e `Manage Actions access` |
| Tunnel Offline antes do deploy | Esperado: ainda não há conector em execução |
| Tunnel Offline depois do deploy | Confira container, token, DNS e saída 7844 |
| Timeout de QUIC | Confira UDP 7844; verifique se o conector consegue fallback HTTP/2 |
| `/healthz` funciona, mas site retorna 502 | Confira rota `http://web:3000`, saúde e logs do conector |
| Login Access funciona, mas Sigma recusa | E-mail ativo no Sigma, issuer/AUD corretos e vínculo de identidade |
| Base web vazia | O deploy não importa a base automaticamente; execute a etapa 15 |
| Backup rejeitado | Confira formato/checksum, tamanho e se exportou pelo mecanismo novo do Sigma |
| JSON de migração sem os leads esperados | Perfil errado ou leitura local incompleta; conserve o original e confira a exportação |
| Novo e-mail em `SIGMA_OWNER_EMAIL` não vira proprietário | O Secret inicial não substitui o cadastro persistido; use o proprietário atual para cadastrar o novo |

### 18.1. Se o primeiro deploy falhar

Na versão atual do script, as validações informam o nome da configuração
inválida e o formato esperado. Depois aparecem marcadores de progresso:

```text
Configuração validada; verificando a referência da imagem.
Release preparada; iniciando conexão SSH com a OCI.
```

Uma falha anterior ao segundo marcador não é evidência de problema no Docker
da VPS: a preparação pode ter falhado antes de conectar. Confira primeiro a
mensagem `::error::` no Actions. Não habilite `set -x` para obter detalhes,
pois o script manipula chaves e tokens.

O job `Build e smoke test` inclui instalação de dependências, testes, build
da imagem, download do Chromium e publicação no GHCR. Cinco minutos no
primeiro build, sem cache, não demonstram travamento. O job tem limite de
35 minutos. Abra a etapa em execução e acompanhe os logs.
O smoke test web tem até 90 verificações com intervalo de 2 segundos, além
do tempo inicial de download/inicialização da imagem; não é um tempo mínimo
de espera e termina assim que o container fica saudável.

Na VPS, a primeira execução pode ainda não ter criado o atalho `current`.
Nesse caso, confira as releases existentes:

```bash
ls -lt "$HOME/sigma-web/releases"
```

Entre na pasta correspondente ao run/attempt mostrado na pipeline:

```bash
cd "$HOME/sigma-web/releases/ID_DA_RELEASE"

sudo docker compose -p sigma-web ps
sudo docker compose -p sigma-web logs --tail=150 web cloudflared
```

O ID é composto pelo número do run do GitHub e sua tentativa, como
`123456789-1`. Não escolha uma release antiga sem conferir o run.

### 18.2. Se o host tem internet, mas o container parece não ter

Com o serviço web iniciado:

```bash
cd "$HOME/sigma-web/current"

sudo docker compose -p sigma-web exec -T web \
  node -e "fetch('https://ghcr.io/v2/',{signal:AbortSignal.timeout(10000)}).then(r=>console.log('HTTPS no container:',r.status)).catch(e=>{console.error(e.message);process.exit(1)})"
```

Uma resposta HTTP confirma a saída HTTPS do container. Se o host conecta
e esse teste falha, confira DNS/rede bridge e regras de encaminhamento do
Docker, além dos logs do conector.

### 18.3. Se o proprietário inicial foi cadastrado com e-mail incorreto

Se houver um proprietário que consegue entrar, use a tela **Usuários** para
cadastrar o e-mail correto. Preserve pelo menos um proprietário ativo.

Se ninguém consegue entrar, preserve o volume e o arquivo de usuários. A
correção administrativa deve ser feita com backup e controle do acesso à
VPS; não tente resolver apagando `/data` ou o volume inteiro.

## 19. Checklist final

- [ ] Reserva integral do perfil local guardada fora do Git.
- [ ] Sistema, arquitetura e recursos da VPS conferidos.
- [ ] SSH exclusivo da pipeline testado sem interação.
- [ ] `known_hosts` verificado e cadastrado integralmente.
- [ ] Rede de saída confirmada.
- [ ] Aplicação Access cobre todo `sigma.ricardohenrique.com`.
- [ ] Método de login funciona e proprietário está na política Allow.
- [ ] `SIGMA_ACCESS_ISSUER` e `SIGMA_ACCESS_AUD` pertencem à equipe/app corretos.
- [ ] Tunnel criado; token copiado pela opção Docker e cadastrado como Secret.
- [ ] Environment `oci` contém todos os Secrets obrigatórios.
- [ ] `OCI_ARCH` é variável de repositório e combina com a VPS.
- [ ] Código atual completo publicado na branch `main`.
- [ ] Pipeline verde nos dois jobs.
- [ ] `/healthz` responde e `/ready` do conector retorna 200.
- [ ] Rota pública aponta para `http://web:3000`.
- [ ] DNS aponta ao Tunnel e cache do hostname está em bypass.
- [ ] Proprietário entra pelo Access e vê seu perfil correto.
- [ ] JSON portátil exportado do perfil correto e importado.
- [ ] Leads, análises, grupos, histórico e Kanban conferidos.
- [ ] Operador cadastrado no Sigma e permitido no Access.
- [ ] Operador consulta/anota/atualiza status/move cards, sem funções administrativas.
- [ ] Backup externo do servidor guardado.

### Limites atuais que fazem parte desta entrega

- A publicação usa uma única instância Node com persistência JSON. Não
  execute réplicas simultâneas sobre o mesmo volume.
- Extrações/análises iniciadas rodam no servidor, mas não há garantia de
  retomada de tarefas em execução após reboot. Lotes ainda não iniciados
  pela interface não equivalem a uma fila persistente no backend.
- WhatsApp/campanhas seguem desativados na configuração atual. A web
  preserva/importa o histórico, mas a conexão/envio de mensagens não foi
  implementada nessa versão web.
- O acesso real pela Cloudflare, o container na OCI e a interface gráfica
  precisam ser validados no ambiente de produção. No ambiente do agente,
  passaram testes e build; SSH/Docker/Electron tiveram restrições de execução.

### Arquivos de referência do projeto

- [Workflow de deploy](.github/workflows/deploy-oci.yml)
- [Compose da versão web](deploy/web/compose.yml)
- [Dockerfile da versão web](deploy/web/Dockerfile)
- [Exemplo de configuração](deploy/web/.env.example)
- [Contrato de perfis e acesso](docs/perfis-e-acesso.md)
- [Detalhes técnicos da versão web](deploy/web/README.md)

**Sobre a pasta `deploy/desktop`:** os documentos dela descrevem a proposta
noVNC anterior. A pipeline atual publica `deploy/web`. Ela ainda reutiliza
alguns scripts administrativos de `deploy/desktop`; esses arquivos também
precisam ser publicados, mas isso não significa que o deploy atual use noVNC.
