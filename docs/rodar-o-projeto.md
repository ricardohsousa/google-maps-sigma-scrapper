# Rodar o projeto

Guia para instalar, rodar em desenvolvimento, testar e gerar o instalador do Sigma GMaps Scraper.

O app é um desktop **Electron** (janela nativa) com interface **React + Vite**. Não há servidor nem banco de dados: tudo roda e fica salvo na máquina local.

---

## 1. Pré-requisitos

| Item | Versão | Para quê |
|---|---|---|
| Windows 10/11 64-bit | — | Plataforma principal do app (Linux tem script de build, mas é menos testado) |
| [Node.js](https://nodejs.org) | 20 ou superior (LTS recomendado) | Rodar e buildar o projeto |
| [Git](https://git-scm.com) | qualquer recente | Clonar e atualizar o código |
| Google Chrome | qualquer recente | Usado pelo **scraper** (opcional se for usar só a Places API) |

Confira no terminal:

```bash
node -v   # v20.x ou superior
npm -v
git --version
```

---

## 2. Clonar e instalar

```bash
git clone git@github.com:ricardohsousa/google-maps-sigma-scrapper.git
cd google-maps-sigma-scrapper
npm install
```

O `npm install` baixa, além das bibliotecas:

- o binário do **Electron** (~100 MB);
- o binário do **ffmpeg** (usado para converter áudio);
- dependências nativas como `sharp`.

É preciso internet e pode levar alguns minutos na primeira vez. As versões ficam travadas pelo `package-lock.json`, então todo mundo instala exatamente o mesmo conjunto.

### Navegador do scraper

O scraper tenta primeiro o **Google Chrome instalado** no sistema. Se não houver Chrome, ele usa o Chromium do Playwright, que precisa ser baixado uma vez:

```bash
npx playwright install chromium
```

Se você só vai usar a **Places API oficial**, o navegador ainda é usado para buscar e-mails nos sites das empresas; sem ele, a extração funciona, mas sem e-mails.

---

## 3. Rodar em desenvolvimento

```bash
npm start
```

Isso faz o build da interface (`renderer/dist`) e abre a janela do Electron.

| Comando | O que faz | Quando usar |
|---|---|---|
| `npm start` | Builda a interface e abre o app | Uso normal |
| `npm run start:quick` | Abre o app **sem** rebuildar a interface | Mudou só arquivos do processo principal (`main.js`, `scraper.js`, `places-api.js`, `utils/`…) |
| `npm run dev:renderer` | Vite em `http://localhost:5173` com recarga automática | Ajustes visuais rápidos no React. **Atenção:** no navegador não existe a ponte com o Electron, então extração, IA e configurações não funcionam por ali |

No Windows também existe o `start-fresh.cmd`: fecha instâncias antigas do app, limpa a pasta temporária da interface, rebuilda e abre. Use quando a interface parecer "presa" numa versão antiga.

### Onde ficam os dados

O app salva tudo na pasta de dados do Electron do usuário (no Windows, dentro de `%APPDATA%`): leads, scoring, Kanban, configurações e a chave da Places API (cifrada). Apagar essa pasta zera o app.

---

## 4. Configurações principais

- **`config.js`**: tempos do scraper, modo headless e a chave `WHATSAPP_ENABLED` (vem `false`; o WhatsApp e as campanhas ficam desligados). Depois de mudar `WHATSAPP_ENABLED`, rode `npm start` (precisa rebuildar a interface).
- **Places API e Gemini**: configurados dentro do app. Veja [Configurar as APIs do Google](configurar-google-apis.md).

---

## 5. Testes

```bash
npm test
```

Roda a suíte com o test runner nativo do Node (`node --test`), sem abrir o app. Rode antes de cada commit.

Para rodar um arquivo só:

```bash
node --test test/places-api.test.js
```

QA visual (abre o app em modo de captura e salva prints das telas):

```bash
npm run qa:ui
```

> Com o WhatsApp desligado, as capturas da tela de WhatsApp desse script devem falhar; o restante continua válido.

---

## 6. Gerar o instalador

```bash
npm run build:win     # Windows: instalador NSIS + ZIP portátil em dist/
npm run build:linux   # Linux: AppImage + .deb em dist/
```

- Rode o build do Windows **no Windows** (dependências nativas são compiladas para o sistema atual).
- Os arquivos saem em `dist/`. O `.exe` do NSIS é o recomendado para distribuir.
- `dist/win-unpacked/` é só uma saída de teste; não use para validar atualização automática.

### Publicar uma versão (atualização automática)

O app instalado procura atualizações nas **GitHub Releases** de `ricardohsousa/google-maps-sigma-scrapper` (campo `build.publish` do `package.json`).

1. Suba a versão em `package.json` (ex.: `1.2.0` → `1.2.1`).
2. Rode `npm run build:win`.
3. Crie uma release no GitHub com a tag `v1.2.1` e anexe de `dist/`:
   - `Sigma-GMaps-Scraper-1.2.1-x64.exe`
   - o `.blockmap` correspondente
   - `latest.yml`
4. Instalações existentes detectam a nova versão sozinhas.

---

## 7. Problemas comuns

| Sintoma | Solução |
|---|---|
| `npm install` falha baixando Electron ou ffmpeg | Verifique internet/proxy e rode `npm install` de novo |
| "Falha ao abrir navegador" ao extrair | Instale o Google Chrome ou rode `npx playwright install chromium` |
| Interface antiga aparece depois de mudar o código | Rode `npm start` (não o `start:quick`) ou o `start-fresh.cmd` |
| `Cannot find module …` ao rodar testes | Faltou `npm install` |
| App abre mas extração pela API dá erro de chave | Veja a tabela de erros em [Configurar as APIs do Google](configurar-google-apis.md) |
| Janela não aparece | O app pode estar minimizado na bandeja do sistema (ícone perto do relógio) |
