# Perfis e acesso do Sigma

Decisão de produto: dois perfis, **Proprietário** e **Operador**, em uma base
compartilhada. O operador consulta a base e trabalha os leads com alterações
operacionais limitadas. O backend em `server/` e a interface web implementam
este contrato. A ativação em produção depende das configurações do Access,
dos Secrets de deploy e da publicação na OCI.

## Permissões acordadas

| Ação | Proprietário | Operador |
|---|---|---|
| Consultar, pesquisar e filtrar leads e análises existentes | Sim | Sim |
| Consultar o Kanban | Sim | Sim |
| Adicionar anotações ao lead | Sim | Sim |
| Atualizar status de atendimento/prospecção | Sim | Sim |
| Mover leads entre etapas existentes do Kanban | Sim | Sim |
| Extrair ou importar novos leads | Sim | Não |
| Alterar dados cadastrais do lead | Sim | Não |
| Excluir leads ou limpar a base | Sim | Não |
| Exportar dados | Sim | Não |
| Executar novas análises de scoring/IA | Sim | Não |
| Editar etapas, regras ou automações do Kanban | Sim | Não |
| Gerenciar usuários e seus perfis | Sim | Não |
| Configurar integrações, credenciais e limites | Sim | Não |

Envio de mensagens/campanhas, conexões WhatsApp, valores comerciais e outras
ações não incluídas nas três alterações operacionais permitidas permanecem
restritos ao proprietário nesta primeira versão. As funções WhatsApp seguem
também sujeitas à configuração global já existente do produto.

## Cloudflare como identidade

O login da versão web é feito pelo **Cloudflare Access**, em frente a
`sigma.ricardohenrique.com`. O WAF continua filtrando requisições; ele não
define as permissões internas do Sigma.

Fluxo previsto:

```text
Login no Cloudflare Access
  → requisição com identidade assinada
  → backend valida o token do Access
  → backend encontra usuário e perfil no Sigma
  → backend autoriza a ação e os campos permitidos
```

O backend valida assinatura, emissor, audiência da aplicação e validade
do JWT recebido em `Cf-Access-Jwt-Assertion`. O vínculo usa a identidade
verificada (`sub` e e-mail), com perfil persistido no servidor. O proprietário
inicial é cadastrado explicitamente no provisionamento; não existe regra de
"primeiro visitante vira proprietário".

O usuário faz um único login pelo Access. Não é necessário criar uma senha
local no Sigma, mas é necessário manter seu cadastro, perfil e estado ativo
no backend. Uma política Allow no Access permite chegar ao aplicativo;
somente usuários ativos cadastrados no Sigma podem usar seus recursos.
Usuário sem vínculo ou com perfil desconhecido não recebe acesso automático.

Referência oficial:
[validação do JWT do Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Requisitos de implementação

- Aplicar permissões no backend em cada leitura e alteração; a interface
  também deve apresentar apenas ações autorizadas. O cliente não escolhe
  nem informa um perfil confiável para a autorização.
- Validar por lista explícita os campos de cada alteração operacional.
  Atualizar uma nota/status não pode alterar nome, telefone, site, valores,
  configurações ou quaisquer outros campos enviados junto ao payload.
- Preservar campos omitidos. Hoje `sanitizeOutcome` e `recordDeal` agrupam
  notas/status com valores e outros atributos; não podem ser expostos
  diretamente como atualização genérica ao operador.
- Registrar usuário, horário, ação e lead afetado para anotações, mudanças
  de status e movimentações. Não guardar tokens/credenciais no histórico.
- Testar tentativas diretas de ações proibidas e injeção de campos extras,
  além dos fluxos permitidos de cada perfil.
- Manter dados compartilhados no servidor e sessões individuais. O perfil
  atual em localStorage/Electron não oferece essa identidade por visitante.

## Consequência para o deploy

A stack noVNC preparada anteriormente expõe uma única sessão desktop.
O login no Access, sozinho, não faz o Electron distinguir o proprietário
do operador que controla essa mesma sessão. Portanto, essa stack não atende
ao acesso simultâneo com permissões individuais definido aqui.

O acesso do operador usa a versão web com backend autenticado e autorização
por usuário. A pipeline atual aponta para `deploy/web/Dockerfile` e a stack
`sigma-web`. A implantação noVNC anterior não implementa os dois perfis.
Configuração, limites e migração: [guia web](../deploy/web/README.md).
