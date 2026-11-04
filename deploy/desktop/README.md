# Sigma inteiro na VPS, acessível pelo navegador

Para a **nova OCI de 1 vCPU e 6 GB de RAM com perfis individuais**, siga o
[guia da versão web](../web/README.md), usado pela pipeline atual. Esta pasta
conserva a implantação noVNC anterior, com sessão desktop compartilhada.

Esta implantação executa o **Electron original** em um display virtual. O
noVNC transmite a interface ao navegador; o scraper, scoring, dados e sessões
continuam na VPS quando a aba é fechada. Não é uma conversão para web nativa.

```text
Navegador → HTTPS / Cloudflare Access + WAF → Cloudflare Tunnel
          → 127.0.0.1:6080 / noVNC → Sigma / Electron + Playwright
```

Uma sessão é compartilhada por todos os acessos autorizados: não há contas ou
bases separadas por visitante. A flag `WHATSAPP_ENABLED` de `config.js` é
preservada (atualmente `false`); este deploy não ativa mensagens ou campanhas.

## Escolher a máquina

A documentação do Matchlogs, consultada em 03/11/2026, descreve a Hostinger
como servidor da aplicação e a OCI ARM como servidor do PostgreSQL e da
observabilidade. Isso **não confirma o consumo atual** nem a capacidade livre.
Execute em cada VPS, somente para leitura:

```bash
bash deploy/desktop/preflight.sh
```

Confira CPU, memória livre, disco e containers atuais. A stack começa limitada
a **1 CPU, 2 GiB de RAM, 512 processos e 256 MiB de /dev/shm**. A imagem, o
build e os navegadores também precisam de espaço em disco e recursos durante
a construção. Teste uma extração real e scoring para ajustar os limites.
O limite de 2 GiB é um ponto inicial, não uma garantia de capacidade.

Prefira a Hostinger se houver margem, para evitar disputar recursos com o
banco na OCI. A imagem permite build na arquitetura do host (amd64 ou arm64);
é necessário validar o build e os navegadores na máquina escolhida.
Não reutilize compose, redes, banco ou volumes do Matchlogs.

## Instalação na VPS

Requisitos: Docker Engine com Compose v2, Bash, OpenSSL e o código atual do
projeto em uma pasta própria, por exemplo `/opt/sigma`. Transfira o código
sem `node_modules`, perfis locais ou credenciais. O Dockerfile usa os arquivos
atuais do checkout, inclusive alterações locais ainda não publicadas.

Na raiz do projeto:

```bash
bash deploy/desktop/preflight.sh
bash deploy/desktop/setup.sh
cp deploy/desktop/.env.example deploy/desktop/.env
docker compose -f deploy/desktop/compose.yml config --quiet
docker compose -f deploy/desktop/compose.yml build
docker compose -f deploy/desktop/compose.yml up -d
docker compose -f deploy/desktop/compose.yml ps
docker compose -f deploy/desktop/compose.yml logs --tail=100 desktop
curl -I http://127.0.0.1:6080/vnc.html
```

O Compose carrega `.env` junto ao arquivo `compose.yml`. Ajuste esse arquivo
antes de subir se a capacidade medida exigir. Não rode o build simultaneamente
a um deploy do Matchlogs.

Teste inicialmente com um túnel SSH a partir do seu computador:

```bash
ssh -L 6080:127.0.0.1:6080 USUARIO@HOST_DA_VPS
```

Abra `http://localhost:6080/vnc.html?autoconnect=true&resize=scale`.
A senha VNC fica em `deploy/desktop/secrets/vnc-password` na VPS. Consulte-a
localmente; não coloque senha em URL nem no Git. O setup gera a senha uma vez
e preserva o valor em novas execuções. O diretório de secrets tem modo 0700.

Não publique as portas 5900/6080 no IP público. O VNC escuta apenas dentro
do container e o HTTP é publicado no loopback da VPS.

## Cloudflare: sigma.ricardohenrique.com

1. **Antes de publicar a rota**, crie uma aplicação **Access / Self-hosted**
   para `sigma.ricardohenrique.com`, cobrindo todos os caminhos. Adicione uma
   política Allow somente para os e-mails autorizados, com o login escolhido
   (por exemplo, código por e-mail). Não use uma política Bypass/Everyone.
2. No Tunnel que alcança a VPS escolhida, adicione exclusivamente o hostname
   `sigma.ricardohenrique.com`, apontando para `http://127.0.0.1:6080` se o
   `cloudflared` roda no host ou com rede de host. Se ele roda em container
   bridge, o loopback pertence ao próprio container: use um conector dedicado
   ao Sigma ou uma rota privada explicitamente configurada. Não altere às
   cegas o conector do Matchlogs nem abra a porta para contornar esse caso.
3. Use a zona DNS `ricardohenrique.com`. A rota de um Tunnel gerenciado pelo
   painel normalmente cria seu CNAME; não aponte um registro A para a VPS.
   Se reutilizar o Tunnel do Matchlogs, adicione a rota sem substituir as
   existentes. Caso seja gerenciado por arquivo, insira a regra antes do
   catch-all e valide a configuração antes de recarregar o conector.
4. Mantenha WebSockets habilitados na zona e as regras WAF disponíveis no seu
   plano. Evite cache da aplicação nesse hostname. O WAF verifica a requisição
   inicial de upgrade; ele **não inspeciona os frames VNC** após a conexão.
   O Access controla a identidade e a senha VNC protege a sessão remota.
5. Abra uma janela anônima: deve aparecer o login do Access **antes** de
   qualquer tela do noVNC. Teste um usuário não autorizado. Em seguida teste
   login autorizado e a conexão WebSocket.

Endereço de acesso após a configuração:

```text
https://sigma.ricardohenrique.com/vnc.html?autoconnect=true&resize=scale
```

Não coloque regras WAF de bloqueio ou liberação para o domínio inteiro por
causa do Sigma: limite alterações a esse hostname.

Referências oficiais:
[Access self-hosted](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[Tunnel](https://developers.cloudflare.com/tunnel/get-started/),
[WebSockets e WAF](https://developers.cloudflare.com/network/websockets/),
[noVNC](https://github.com/novnc/noVNC).

## Dados, exportações e limites

- O volume Docker `sigma_profile` guarda `/data`: configurações, perfil
  Chromium/Electron (incluindo localStorage), sessões, mídias e arquivos.
  Recriar o container mantém esses dados. **Não use `down -v`.**
- A primeira execução começa com uma base vazia. A base do desktop local
  não é migrada automaticamente. Importe/exporte os leads pelo app; uma
  migração integral exige backup e validação das sessões e chaves cifradas
  pelo sistema operacional de origem.
- Exportações e diálogos de arquivo usam o filesystem remoto. O diretório
  de downloads é `/data/Downloads`; selecione-o ao salvar. Para trazer uma
  exportação ao seu computador, primeiro copie com `docker compose cp` para
  um diretório da VPS e depois use SCP/SFTP. O noVNC não transfere arquivos
  nem encaminha o microfone ou áudio do seu computador. QR Code funciona
  pela imagem da sessão. Se áudio/microfone ou uploads/downloads diretos pelo
  navegador forem necessários, prefira uma futura versão web nativa.
- Fechar a aba desconecta apenas o visor. Se um processo supervisionado
  terminar (inclusive fechar o Electron), o container reinicia. O app pode
  pedir confirmação para retomar campanhas interrompidas; as extrações em
  andamento não possuem garantia de retomada após falha ou reboot.
- O container roda sem root, sem capabilities, com filesystem da imagem
  somente leitura e limites de recursos. O Electron usa `--no-sandbox`
  por compatibilidade com Docker/VPS; o isolamento é o container, não o
  sandbox Chromium. Não monte diretórios do Matchlogs nem o socket Docker.
- A configuração atual de chaves do app pode usar armazenamento sem cifra
  quando o cofre do sistema não está disponível no Linux. Proteja o volume
  e os backups, que contêm credenciais e dados privados.

## Backup consistente

Pare o app para copiar o perfil de forma consistente (inclui localStorage e
sessões). Na raiz do projeto, com o container já criado:

```bash
mkdir -p deploy/desktop/backups
chmod 700 deploy/desktop/backups
docker compose -f deploy/desktop/compose.yml stop desktop
docker compose -f deploy/desktop/compose.yml cp desktop:/data/. deploy/desktop/backups/profile
docker compose -f deploy/desktop/compose.yml start desktop
```

Use uma pasta de backup nova a cada cópia. Guarde uma cópia externa protegida.
Para restaurar, pare o desktop e copie o perfil para `/data` de um volume
vazio, preservando a propriedade **UID/GID 1000:1000**, depois inicie e valide.
Não restaure o backup sobre um perfil em uso.

## Atualização e diagnóstico

Atualize os arquivos do projeto, faça backup e então reconstrua somente esta
stack. O atualizador desktop não gerencia a imagem Docker:

```bash
docker compose -f deploy/desktop/compose.yml build
docker compose -f deploy/desktop/compose.yml up -d
docker compose -f deploy/desktop/compose.yml ps
docker compose -f deploy/desktop/compose.yml exec desktop /usr/local/bin/healthcheck.sh
```

O healthcheck verifica display, processo da aplicação, HTTP e protocolo VNC.
Um container `unhealthy` exige diagnóstico; Docker não reinicia automaticamente
apenas por esse estado. A policy reinicia containers que terminam. Consulte
logs e o consumo antes de reiniciar, sobretudo em caso de falta de memória.

Antes de considerar a publicação concluída, valide uma extração, scoring,
exportação, reconexão após fechar a aba e persistência após recriar o container.
O build Docker e esses testes precisam ser executados na VPS: o ambiente de
preparação não permitiu acessar o daemon Docker nem estabelecer SSH remoto.
