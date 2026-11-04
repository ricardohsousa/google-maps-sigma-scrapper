# Sigma GMaps Scraper

**Comece pelo [manual completo de publicação na OCI](PASSO_A_PASSO_SIGMA_OCI.md)**:
ele reúne o processo, o estado já validado e as etapas de Cloudflare, GitHub,
deploy e migração da base local.

Versão web com Cloudflare Access, perfis Proprietário/Operador e migração da
base local: [implantação e configuração na OCI](deploy/web/README.md).

Desktop local-first para transformar pesquisas do Google Maps em uma operação de prospecção: encontrar empresas, organizar leads, priorizar oportunidades e iniciar conversas pelo WhatsApp.

[![Release](https://img.shields.io/github/v/release/ricardohsousa/google-maps-sigma-scrapper?display_name=tag)](https://github.com/ricardohsousa/google-maps-sigma-scrapper/releases)
[![License](https://img.shields.io/github/license/ricardohsousa/google-maps-sigma-scrapper)](LICENSE)

## Fluxo do produto

```text
Google Maps → base de leads → lead scoring → WhatsApp → campanha/Kanban → métricas
```

O app combina scraping, tratamento de dados, análise comercial e execução de campanhas em uma única aplicação Electron para Windows.

## Recursos

### Pesquisa e base de leads

- Pesquisa por nicho, bairro ou cidade no Google Maps, com paginação e coleta dos dados públicos disponíveis.
- O modal de extração separa nicho, município digitado e UF selecionada, deixando a busca mais rápida de revisar.
- Campos de negócio como nome, categoria, telefone, site, Instagram, e-mail, avaliação, endereço e coordenadas.
- Deduplicação por negócio e normalização de categorias; variações como “dentista”, “clínica odontológica” e “ortodontia” são agrupadas em **Odontologia**.
- Extrações de planilhas/CSV/XLSX ficam fora da lista de extrações reais do Maps.
- Visualização em tabela ou mapa Leaflet com camada **Ruas**, pins com coordenadas e indicador de precisão.
- Filtros, seleção em lote, exportação CSV/XLSX e filtros rápidos nas últimas extrações (**Todos**, **com site**, **com telefone** e **com e-mail**).
- Site aparece como ícone web (com URL no hover e abertura em janela interna); telefone pode iniciar uma conversa mesmo fora da lista de contatos.

### Lead Scoring

- Auditoria do site do lead para sinais técnicos e comerciais: HTTPS, responsividade, pixel, WhatsApp, presença digital e qualidade do site.
- Score, prioridade, argumentos de abordagem e mensagem sugerida para WhatsApp.
- Grupos salvos por pesquisa/filtro para trabalhar a lista por etapas.
- Análise opcional com **OpenRouter como padrão**, NVIDIA Build como alternativa e OpenCode/custom API quando configurados; há fallback local quando não existe chave disponível.

### WhatsApp

- Conexão de múltiplos números por QR Code usando Baileys ou Meta Cloud API.
- Conversas, contatos, grupos, etiquetas, mensagens, mídia, áudio e gatilhos.
- Nova conversa por telefone digitado, mesmo que o número ainda não esteja na lista; envio de texto, áudio, vídeo, PDF, documentos e arquivos ZIP/RAR/7Z.
- Modo streaming opcional para borrar números de telefone na interface, inclusive em contatos salvos.
- Campanhas com mensagem variável, intervalo, agendamento e limite diário por conexão.
- Uma campanha pode ser criada como **rascunho** mesmo sem WhatsApp conectado; a conexão é exigida apenas para iniciar os disparos.

### Campanhas e Kanban

- Campanhas por lista de leads, com relatório de envio, entrega, leitura, respostas e tempo de resposta.
- Kanban configurável com regras simples para eventos como mensagem enviada, resposta, venda e recusa.
- Adição manual de lead por telefone ou conversa do WhatsApp, com etapa inicial e valor do negócio.
- Lembretes podem ser criados para qualquer contato, com ou sem cartão no Kanban; quando há cartão, a etapa e o lembrete são sincronizados.
- Valores ganhos e pendentes, vendas fechadas, datas de mensagem/resposta e lembretes aparecem no resumo comercial da Visão Geral.
- Mova cards por drag-and-drop ou seletor; leads apagados da base autoritativa não voltam para o quadro.

![Kanban por campanha](docs/qa/open-design-lote1/whatsapp-campaign-kanban-1440x900.png)

![Criação de campanha offline](docs/qa/open-design-lote1/whatsapp-campaign-offline-draft-1440x900.png)

### Interface e operação

- Shell visual baseado no Open Design do produto, com Visão Geral, Scraper Maps, Base de Leads, Lead Scoring, Kanban, WhatsApp e Configurações.
- Painel administrativo com navegação por ícones, análise da base iniciando minimizada e visão geral minimalista com métricas e sino de pendências.
- Atualizações automáticas na versão instalada via GitHub Releases.
- Dados da aplicação e sessões do WhatsApp ficam no perfil local do Electron; chamadas externas acontecem apenas para Maps, sites analisados, WhatsApp e provedores de IA configurados.

## Download para Windows

Baixe a [release mais recente](https://github.com/ricardohsousa/google-maps-sigma-scrapper/releases).

Na release `v1.1.9`, os arquivos são:

- `Sigma-GMaps-Scraper-1.1.9-x64.exe` — instalador NSIS recomendado.
- `Sigma-GMaps-Scraper-1.1.9-x64-complete.zip` — pacote portátil completo.
- `latest.yml` e `.blockmap` — metadados usados pelo atualizador automático.

Após instalar, abra o Sigma e comece por **Nova Extração**. Para usar a Places API oficial ou o Gemini no Lead Scoring, siga [Configurar as APIs do Google](docs/configurar-google-apis.md). O WhatsApp e as campanhas vêm desativados nesta versão (`WHATSAPP_ENABLED` em `config.js`).

> O atualizador automático funciona na versão instalada pelo NSIS. Com o updater ativo, instalações anteriores podem detectar a `v1.1.9` e baixá-la pelo próprio app; instalações `win-unpacked`, portáteis ou com o updater indisponível precisam do download manual. `win-unpacked` é uma saída de teste local e não deve ser usada para validar atualização in-place.

## Desenvolvimento

Passo a passo completo (instalação, testes, build e publicação): [Rodar o projeto](docs/rodar-o-projeto.md).

### Requisitos

- Windows 10/11 64-bit.
- Node.js 20 ou superior.
- Acesso à internet para Maps, sites analisados, downloads e WhatsApp.

### Instalar e executar

```bash
npm install
npm start                 # builda o renderer e abre o Electron
```

Para trabalhar apenas no front-end:

```bash
npm run dev:renderer      # Vite em http://localhost:5173
```

### Comandos úteis

```bash
npm test                  # suíte Node --test
npm run build:renderer    # build do React/Vite
npm run qa:ui             # captura visual das rotas e fluxos principais
npm run build:win         # instalador NSIS + ZIP em dist/
```

O build de produção usa Electron Builder e publica artefatos Windows x64 conforme o campo `build.publish` do `package.json`.

## Estrutura principal

```text
main.js                            Processo Electron e IPC seguro
preload.js                         Ponte entre renderer e processo principal
renderer/                          React + Vite + interface Open Design
lead-scoring/                      Crawler, score, grupos e exportação
campaigns/                         Store, scheduler, analytics e Kanban
whatsapp/                          Providers, autenticação e normalização
scripts/capture-open-design-ui.js  QA visual determinístico
test/                              Testes unitários e de integração local
```

## Contribuir e reportar problemas

- Abra uma [Issue](https://github.com/ricardohsousa/google-maps-sigma-scrapper/issues) com versão, sistema operacional, passos para reproduzir e logs relevantes.
- Pull requests devem manter `npm test` e `npm run qa:ui` verdes.

## Licença

MIT — veja [LICENSE](LICENSE).
