# Configurar as APIs do Google (Places API e Gemini)

Guia para ligar as duas integrações do Google no Sigma:

- **Places API (New)**: coleta oficial de empresas, alternativa ao scraper.
- **Gemini (AI Studio)**: IA opcional do Lead Scoring, que escreve diagnóstico e mensagens de abordagem.

As duas são opcionais e independentes. Sem elas o app continua funcionando com o scraper e com as mensagens geradas por regras locais.

> As telas do Google Cloud e do AI Studio mudam com frequência. Se algum nome de botão não bater, procure pela opção equivalente; o fluxo é o mesmo.

---

## Parte 1 — Projeto e faturamento no Google Cloud

As duas APIs ficam presas a um **projeto** do Google Cloud. Use o mesmo projeto para tudo.

1. Acesse <https://console.cloud.google.com> com a conta que tem os créditos.
2. No seletor de projetos (topo da tela), clique em **Novo projeto**.
   - Nome: `sigma-gmaps` (ou o que preferir).
   - Clique em **Criar** e selecione o projeto recém-criado.
3. Menu ☰ → **Faturamento** (Billing).
   - Vincule o projeto à **conta de faturamento que tem os créditos**. Os créditos só são consumidos por projetos ligados a essa conta.
   - Em **Créditos**, confira se eles aparecem e se cobrem "Google Maps Platform" e/ou "todos os serviços".
4. **Recomendado — alerta de orçamento:** Faturamento → **Orçamentos e alertas** → **Criar orçamento**.
   - Valor: por exemplo R$ 50.
   - Alertas em 50%, 90% e 100%.
   - Isso não bloqueia gastos, apenas avisa por e-mail. O bloqueio de verdade vem pela cota (Parte 2, passo 6).

---

## Parte 2 — Chave da Places API (New)

### Ativar a API

1. Menu ☰ → **APIs e serviços** → **Biblioteca**.
2. Pesquise **Places API (New)** e clique em **Ativar**.
   - Atenção: existe também a "Places API" antiga (legacy). O app usa a **New** (`places.googleapis.com`).

### Criar a chave

3. **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**.
4. Copie a chave (começa com `AIza…`) e clique em **Editar chave de API** para restringi-la:
   - **Nome:** `sigma-places`.
   - **Restrições de aplicativo:** deixe *Nenhuma*. O app é desktop, então restrição por site (referenciador) não funciona; por IP só vale se sua internet tiver IP fixo.
   - **Restrições de API:** marque *Restringir chave* e selecione **somente** `Places API (New)`.
   - Salve.

> Por que restringir: se a chave vazar, ela só serve para a Places API, e não para outras APIs pagas do projeto.

### Limitar o gasto (opcional, recomendado)

5. **APIs e serviços** → **Places API (New)** → aba **Cotas e limites do sistema**.
6. Edite a cota **Text Search requests per day** (o nome pode variar levemente) e defina um teto, por exemplo `500`.
   - Cada busca no app usa de 1 a 3 requisições (20 empresas por requisição, máximo de 60 por busca).
   - Quando o teto é atingido, a API recusa novas buscas até o dia seguinte; o app mostra o erro e nada é cobrado além do limite.

### Custos

- A busca usa a **Text Search** pedindo telefone, site e avaliações, o que cai na faixa de preço **Enterprise** da Places API.
- O Google oferece uma cota gratuita mensal por faixa de preço; acima dela, a cobrança é por 1.000 requisições.
- Os valores mudam; confira em <https://developers.google.com/maps/billing-and-pricing/pricing> antes de rodar volumes grandes.

### Colocar a chave no app

7. Abra o Sigma → **Configurações** → cartão **Origem dos dados do Maps**.
8. Cole a chave em **Chave da Google Places API (New)** e clique em **Validar e salvar**.
   - O app faz uma consulta mínima para validar. Se o Google recusar, a mensagem de erro dele aparece no cartão (os motivos mais comuns estão em "Problemas comuns").
9. Opcional: em **Origem padrão em novas extrações**, escolha **API oficial (Places)**.
10. Em **Nova extração**, passo 3, escolha a origem para aquela busca específica.

A chave fica salva cifrada (cofre do Windows) no arquivo `maps-settings.json`, dentro da pasta de dados do app em `%APPDATA%`, e nunca é exibida inteira na interface.

---

## Parte 3 — Chave do Gemini no Google AI Studio

### Criar a chave

1. Acesse <https://aistudio.google.com> com a mesma conta Google.
2. Clique em **Get API key** (menu lateral) → **Criar chave de API**.
3. Quando perguntar o projeto, escolha o **mesmo projeto** da Parte 1 (`sigma-gmaps`).
   - Assim o uso é cobrado na conta de faturamento com créditos.
4. Copie a chave.

### Plano gratuito x pago

- **Sem faturamento ativado no AI Studio**, a chave usa o *nível gratuito*: tem limites de requisições por minuto/dia e o Google pode usar o conteúdo enviado para melhorar os produtos dele.
- **Com faturamento ativado** (AI Studio → **Faturamento** / *Set up billing*, apontando para a conta com créditos), a chave passa ao nível pago: limites maiores e os dados não são usados para treino. O consumo deve sair dos créditos do Cloud — confirme em Faturamento → Relatórios depois dos primeiros usos.
- O app envia apenas dados públicos (o que veio do Maps e o resumo técnico do site), mas vale saber a diferença.

### Restringir a chave (recomendado)

5. No Google Cloud Console → **APIs e serviços** → **Credenciais**, a chave do AI Studio aparece na lista.
6. Edite-a → **Restrições de API** → selecione apenas **Generative Language API**.

### Colocar a chave no app

O app não tem um provedor "Gemini" pronto, mas o Gemini oferece um endpoint compatível com o formato da OpenAI, que o app aceita pela opção **Custom API**.

7. Sigma → **Lead Scoring** → botão **Configurar**.
8. Em **Provedor de IA**, escolha **Custom API** e preencha:

   | Campo | Valor |
   |---|---|
   | Base URL | `https://generativelanguage.googleapis.com/v1beta/openai` |
   | API Key | a chave do AI Studio |
   | Modelo | um modelo **Flash** listado no AI Studio, por exemplo `gemini-2.5-flash` |

   - Os nomes dos modelos mudam; use o que aparece na lista de modelos do AI Studio. Modelos *Flash* são baratos e bastam para esse uso; *Pro* é mais caro e não traz ganho relevante aqui.
9. Clique em **Testar conexão** e depois salve.
10. Rode uma análise em poucos leads. Se a IA falhar, o Lead Scoring mostra o aviso *"A IA não respondeu… os scores e mensagens saíram das regras locais"*; sem esse aviso e com mensagens personalizadas por empresa, está funcionando.

> Se o teste falhar com erro de formato JSON, o app tenta de novo sem o modo JSON estrito automaticamente. Se mesmo assim falhar, use OpenRouter (que também oferece modelos Gemini) como alternativa.

---

## Problemas comuns

| Mensagem | Causa provável | Solução |
|---|---|---|
| `API key not valid` | Chave copiada errada ou apagada | Copie de novo em Credenciais |
| `This API project is not authorized to use this API` / `PERMISSION_DENIED` | API não ativada, ou chave restrita a outra API | Ative a **Places API (New)** e confira as restrições da chave |
| `Billing has not been enabled` / `BILLING_DISABLED` | Projeto sem conta de faturamento | Parte 1, passo 3 |
| `RESOURCE_EXHAUSTED` / `429` | Cota diária ou por minuto atingida | Aguarde, ou aumente a cota (Parte 2, passo 6) |
| Busca traz só 60 empresas | Limite da própria Text Search | Adicione bairros na extração; cada bairro vira uma busca |
| IA sempre com mensagens genéricas | A IA falhou e o app usou as regras locais | Veja o aviso no topo do Lead Scoring e teste a conexão em **Configurar** |

---

## Segurança das chaves

- Nunca coloque as chaves em arquivos do repositório nem em prints/vídeos.
- Se uma chave vazar: Cloud Console → Credenciais → **Regenerar chave** (ou excluir e criar outra) e atualize no app.
- Mantenha as restrições de API e o alerta de orçamento ativos.
