# radar-da-tropa
Radar da Tropa — consulta pública de relatos e painel de moderação para lives.

## Publicação

O site está em `index.html` e é servido pelo Cloudflare Pages em
`https://radardatropa.pages.dev/`. O arquivo `_redirects` mantém as fichas em
`/perfil/<id>` acessíveis por link direto. O Supabase armazena relatos,
recursos, perfis e anexos.

`radar-upgrade-v5.sql` registra as alterações do banco desta versão.
`radar-upload-check/` verifica anexos no servidor após o upload, e
`radar-appeal-identity/` verifica códigos temporários na bio do TikTok.
As duas funções precisam da chave de serviço como segredo do projeto.
A leitura de perfis usa a página pública do TikTok, sem uma API paga.
Nenhum segredo vai para o HTML público.

Fotos anexadas ficam privadas até o administrador visualizá-las e publicar
uma cópia recriada sem metadados. Vídeos permanecem privados e ainda não têm
remoção automática de metadados. A publicação e retirada de prova são ações
do painel administrativo. Recursos com e-mail opcional podem ser localizados
manualmente se o protocolo for perdido.

## Conferência de perfis

O painel administrativo oferece **Conferir perfil no TikTok** nos relatos ainda
sem identidade vinculada, inclusive nos antigos. A nova tentativa exige uma
sessão de administrador validada no servidor e respeita um intervalo de cinco
minutos. Uma falha nunca transforma o relato em perfil identificado.

O formulário de envio e a nova tentativa mostram falhas da consulta, incluindo
limite do provedor e integração indisponível. A função registra o motivo em
`radar_reports.profile_resolution_error` e escreve falhas de resolução nos logs.
A identificação da conta não confirma a veracidade do relato.

Para disponibilizar esta mudança, é necessário publicar `index.html` no
Cloudflare Pages e as funções `radar-sync/index.ts` e
`radar-appeal-identity/index.ts` no Supabase, incluindo o módulo relativo
`../tiktok-profile.ts` no pacote de cada função. Não basta atualizar somente o
site ou manter o import antigo de uma revisão do GitHub. Não é necessária uma nova migração SQL para esta mudança;
as tabelas e colunas de `radar-profiles.sql` precisam já estar instaladas.

A função usa `SUPABASE_URL`, a chave de serviço e a chave pública (nos nomes
legados ou nos mapas de chaves já suportados pelo código). Não usa
`FETCHLAYER_API_KEY` nem chama o Fetchlayer. Segredos permanecem no Supabase,
nunca no HTML.
Como o envio com PIN usa uma chave publicável em `apikey`, a configuração do
gateway precisa permitir que a função receba essa chamada sem exigir um JWT de
usuário; a própria função valida o PIN, a sessão administrativa ou o token de
agendamento, conforme a operação. Conferir essa configuração ao publicar.

A rotina `scheduledSync` depende de um agendamento externo que envie o segredo
`RADAR_SYNC_TOKEN` no cabeçalho `x-radar-sync-token` (mínimo de 48 caracteres).
O agendamento existente no projeto executa a cada três horas e foi verificado
em 21/10/2026. Relatos pendentes podem ser tentados a cada três horas; perfis já
vinculados são atualizados no máximo uma vez por dia. Cada execução processa
até cinco relatos e cinco perfis, respeitando um orçamento de tempo.
O botão administrativo permite nova tentativa sem depender do cron. Uma chamada
interna autenticada com o token do cron pode enviar `{"retryPending":true}` para
tentar os pendentes após cinco minutos, sem aguardar o intervalo de três horas.

O módulo `tiktok-profile.ts` lê somente os dados estruturados de páginas públicas
em `www.tiktok.com`. Não usa login, cookies, serviços pagos ou técnicas para
contornar bloqueios. Consultas por ID usam o link público `/share/user/<id>` e
só aceitam o resultado se o ID permanente continuar igual; consultas por arroba
exigem correspondência exata (ignorando maiúsculas). Isso permite acompanhar
mudanças de arroba quando o redirecionamento público estiver disponível.

A alternativa é sem cobrança por consulta, mas não é uma API oficial nem tem
garantia de disponibilidade. HTML alterado, captcha, bloqueio, perfil removido,
resposta incompleta ou ID diferente mantêm a identidade sem nova confirmação.
O erro aparece no painel e é registrado no banco. A leitura tem limite de 2 MB,
timeout de dez segundos e redirecionamentos limitados ao domínio HTTPS oficial.
Custos e cotas normais do plano de hospedagem Supabase continuam aplicáveis.

A conferência de código na bio dos recursos também usa essa leitura gratuita.
Falhas de acesso ao TikTok não consomem tentativas de código; uma bio acessível
sem o código continua sendo uma tentativa sem confirmação. A checagem do ID
vinculado continua obrigatória antes de confirmar um recurso.

Testes locais, sem acessar serviços ou alterar dados de produção (Node 24):

```sh
node --test tests/radar-sync.test.mjs
```

## Comunidade, anexos e moderação

- O formulário de solicitação de PIN abre o WhatsApp com nome, arroba e contexto.
  O visitante revisa e envia a mensagem; não há envio automático nem geração de PIN
  sem aprovação. O administrador pode mudar o número em **Contato para solicitações
  de PIN**, dentro do painel. O número fornecido pelo dono foi configurado no banco.
- O selo **Streamer verificado** é concedido/retirado pelo administrador após uma
  conferência manual. Começa desativado para todos e some publicamente se o acesso
  do streamer for suspenso. O selo pertence à equipe Radar, não ao TikTok, e não
  comprova a veracidade de uma denúncia.
- A consulta agrupa pelo ID permanente da conta quando disponível; sem ID, somente
  pelo arroba exato, ignorando maiúsculas. A busca aproximada encontra perfis, mas não
  os funde. Cada grupo mostra relatos publicados, autores, contagem e links de provas.
  Grupos têm paginação; cada grupo devolve no máximo os 50 relatos mais recentes.
- As estatísticas contam apenas relatos publicados e streamers ativos. Contatos,
  PINs, recursos, protocolos e denúncias em análise não entram nas respostas públicas.
- Fotos usam fallback de decodificação compatível com Safari e são recriadas em JPEG
  antes do envio. O MIME real da imagem preparada é usado no ticket e no Storage.
  HEIC/HEIF dependem de o navegador conseguir abrir a foto; quando não conseguir,
  o formulário orienta enviar uma captura JPG/PNG. Até 3 arquivos, 20 MB por arquivo.
- Uma falha preserva a seleção de arquivos, o relato/protocolo e a reserva de upload
  na aba atual. A nova tentativa reutiliza o mesmo registro e ticket; o estado não
  sobrevive ao fechamento/recarregamento da aba. Anexos originais continuam privados.
- Corrigidas as permissões do verificador de anexos (SELECT/UPDATE/DELETE somente
  para service_role), o limite concorrente de três tickets, o limite de leitura no
  servidor e a publicação de provas com caminho/estado/MIME validados. A operação de
  cancelar anexo exige o segredo do envio e só aceita relatos/recursos ainda pendentes.

Migrações aplicadas no projeto existente estão em `supabase/migrations/`, com as
versões confirmadas no histórico remoto. Os arquivos SQL antigos continuam sendo
parte da instalação anterior; estas migrações não substituem o esquema inicial.

Validação em 21/10/2026: 35 testes automatizados, navegação em Chromium com largura
390 px, teste real de upload PNG→JPEG com fallback de Safari e falha temporária,
reenvio sem duplicação, verificação do anexo e limpeza autenticada dos dados de
ensaio. Agrupamento, estatísticas e selo foram exercitados em transação revertida.
Não houve envio de mensagem no WhatsApp durante os testes.

A revisão de segurança preserva as tabelas privadas sem políticas de acesso direto:
nesses casos RLS bloqueia as linhas, e apenas as funções deliberadamente expostas
executam operações limitadas. Avisos do Advisor sobre funções SECURITY DEFINER
públicas permanecem para essas APIs intencionais, com grants explícitos e guards
administrativos nas operações de moderação. A função interna de evento não pode
mais ser chamada por anon/authenticated. A proteção de senhas vazadas do Supabase
Auth continua desativada na configuração da conta; não é controlada por esta mudança.
Vídeos permanecem privados e não passam por remoção automática de metadados.

Para conferir tudo novamente: `node --test tests/*.test.mjs`.
A interface nova é publicada no GitHub Pages pelo fluxo existente do repositório.
O Cloudflare Pages precisa receber o pacote estático atualizado separadamente:
`index.html`, `_redirects` e `og.png`; compartilhar o banco não atualiza esse HTML.

Uma recuperação interna autenticada também pode usar `{"refreshProfiles":true}`
para atualizar até cinco perfis já vinculados após cinco minutos da última
consulta. Isso permite migrar os erros antigos do provedor pago sem adulterar
as datas de tentativa; chamadas normais mantêm o intervalo diário.

Quando a rota pública por ID estiver indisponível, a atualização diária pode
consultar o último arroba conhecido. O resultado só é salvo se o ID permanente
continuar igual. A segunda tentativa não é feita após limite de requisições.
Se o arroba tiver sido transferido para outra conta, a atualização é recusada.

## Publicação automática no Cloudflare

O fluxo `.github/workflows/cloudflare-pages.yml` executa nos pushes da branch
`main` e também pelo botão **Run workflow** no GitHub Actions. Não exige ZIP,
computador ligado ou projeto novo. O projeto Cloudflare existente é consultado
antes do envio; o fluxo exige o nome `radardatropa`, o domínio já usado e a branch
real de produção. Sem confirmação, ele interrompe e nunca cria um projeto.

Uma única configuração inicial é necessária em
[Settings → Secrets and variables → Actions](https://github.com/jose-sites/radar-da-tropa/settings/secrets/actions):

- `CLOUDFLARE_API_TOKEN`: token restrito à conta do Radar, com permissão
  **Account → Cloudflare Pages → Edit**.
- `CLOUDFLARE_ACCOUNT_ID`: ID da conta Cloudflare que contém o projeto.

O token é criado no [painel do Cloudflare](https://dash.cloudflare.com/profile/api-tokens)
e colado diretamente no segredo do GitHub. Não deve ser enviado no chat ou
incluído em arquivos do repositório. O Account ID está no painel da conta; não é
um domínio nem o ID do projeto Supabase.

Sem os dois segredos, o fluxo registra **Falta autorizar o Cloudflare uma vez**
e não tenta publicar. Depois de salvá-los, executar o fluxo uma vez (ou enviar
uma alteração à `main`) inicia a primeira atualização. Daí em diante, cada push
publica automaticamente. O acesso ao Supabase continua separado.

O fluxo tem permissão de leitura do repositório, usa ações fixadas por commit,
executa os testes, fixa a versão do Wrangler e envia somente `index.html`,
`_redirects`, `og.png` e `story-approved-v1.webp`. Após o envio, compara o HTML público com a versão enviada.
Os segredos são usados apenas no runner do GitHub e não vão para os arquivos
públicos. É possível revogar o token no Cloudflare para suspender a integração.

Referência: [Direct Upload com CI/CD](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

### Fotos: prévia e acompanhamento

Os formulários de denúncia e recurso mostram a prévia e o estado individual dos
anexos: preparando, enviando (percentual medido pelo navegador), verificando,
concluído ou erro detalhado. Uma falha preserva o arquivo para nova tentativa.
URLs de prévia são liberadas ao trocar a seleção ou sair da área do streamer.
O progresso de upload usa XMLHttpRequest; os dados e segredos não vão para URLs.

### Filtros no painel

O painel permite combinar busca, situação, categoria, identidade e estado dos
anexos, com ordenação e filtro de recursos. Os totais permanecem globais; rascunhos
de revisão são mantidos ao alternar filtros na mesma sessão. A RPC v5 continua
exclusiva da administração e informa anexos com verificação pendente.

### Ficha completa

`/ficha/<relato-publicado>` reúne os relatos publicados da mesma conta, com
paginação, provas públicas revisadas e primeira observação dos arrobas. Datas
de observação não são apresentadas como datas exatas de mudança. Contas com
identidade confirmada são agrupadas pelo ID estável; as demais, por arroba exato.
Cada relato mantém seu próprio link, recurso e pedido de revisão de dados.
`tests/dossier.sql` verifica o contrato com fixtures integralmente revertidas.

### Pedidos de PIN com acompanhamento

A solicitação gratuita é registrada no Supabase antes de abrir o WhatsApp. O
solicitante recebe um protocolo privado, conserva a tentativa no sessionStorage
para repetir após falhas e pode consultar recebido/em análise/respondido.
O WhatsApp apenas abre uma mensagem preparada; o solicitante escolhe enviá-la.
O protocolo não é incluído nessa mensagem e seu hash é o único valor persistido
no banco. O pedido não cria um streamer, PIN ou selo automaticamente.

No painel, a administração filtra pedidos, abre o contato opcional e salva uma
resposta de acompanhamento separada da nota interna. O telefone não aparece na
consulta por protocolo. Há controle de repetição por arroba (10 minutos) e cinco
novos pedidos por endereço encaminhado pelo gateway por hora; esse controle de
conexão é adicional e depende dos cabeçalhos do gateway. Não há leitura direta
nas tabelas por clientes, e as ações administrativas exigem um administrador.
`tests/pin-requests.sql` verifica privacidade, autorização, limite e repetição
segura dentro de uma transação integralmente revertida.

Testes de navegador móvel, com API simulada e sem mensagens ou gravações reais:

```sh
RADAR_PLAYWRIGHT_MODULE=/caminho/para/playwright node tests/browser-smoke.cjs photos
RADAR_PLAYWRIGHT_MODULE=/caminho/para/playwright node tests/browser-smoke.cjs panel
RADAR_PLAYWRIGHT_MODULE=/caminho/para/playwright node tests/browser-smoke.cjs dossier
RADAR_PLAYWRIGHT_MODULE=/caminho/para/playwright node tests/browser-smoke.cjs pin
```

### Publicação pelo acesso do administrador

O streamer reservado à administração pode ter `auto_publish_by` vinculado a um
administrador existente. Só esse acesso aceita o PIN numérico personalizado de
10 dígitos; os acessos comuns mantêm os PINs de 12/20 caracteres e moderação.
O PIN real é configurado diretamente como hash no banco, nunca no HTML, Git ou
migration. Essa permissão não concede login ao painel administrativo.

A tela informa o modo automático antes do envio. Primeiro salva o relato
pendente e verifica os anexos privados; a função `radar-publish-owned` publica
cópias e só então conclui a publicação. Fotos são preparadas sem metadados pelo
navegador; a cópia pública também descarta EXIF, comentários e metadados de imagem.
MP4 de até 30 segundos é aceito e exibido em player, removendo metadados de usuário
do contêiner sem deslocar os dados do vídeo. Isso não remove dados pessoais
visíveis no conteúdo: quem publica precisa conferir os arquivos antes de enviar.

A função exige o PIN correspondente ao autor e permissão ativa. RPCs de início,
conclusão e cancelamento são exclusivas de `service_role`. Uma reserva curta
impede publicações concorrentes. Falhas preservam os originais e permitem repetir
sem criar outro relato; uma resposta final perdida não apaga provas já publicadas.
O painel mantém a capacidade de retirar relatos e provas. A autorização não
publica relatos antigos nem comprova automaticamente a identidade no TikTok.

Testes adicionais: `tests/owned-publication.test.mjs`, a transação revertida
`tests/owned-publication.sql` e `node tests/browser-smoke.cjs owned`.

### Histórico de arroba e resolução de casos

As fichas e cartões destacam arrobas anteriores somente quando vinculados à mesma
identidade confirmada do TikTok. A administração pode marcar um relato publicado
como resolvido ou reaberto, com explicação pública. A alegação original permanece,
e cada alteração tem histórico com data; identificadores privados do administrador
não são expostos. A tabela de eventos é privada e a RPC de alteração exige admin.
`tests/report-resolution.sql` usa uma transação revertida para verificar os limites.

A interface é estática: sem animações, transições ou rolagem suave; os controles
continuam respondendo ao usuário e arquivos continuam sendo enviados normalmente.

### Conferência antes de enviar

Novos relatos abrem uma prévia com categoria, arroba, descrição, data e anexos
antes de qualquer criação de relato ou upload. A confirmação usa o conteúdo
conferido, e voltar para editar preserva os campos. O acesso da administração
confirma a publicação automática; os demais confirmam o envio à moderação.
Novas tentativas de um envio já salvo reutilizam o mesmo relato.

### Cartão para compartilhar

Cada relato público pode gerar um PNG de 1080×1920 no próprio navegador, em formato de Story, com foto pública
do perfil em uma moldura, categoria, arroba, situação e endereço do Radar. O link
completo acompanha o compartilhamento e permanece disponível para copiar. O botão usa a consulta
pública do relato antes de gerar; um relato retirado não gera um novo cartão.
O usuário escolhe abrir o compartilhamento nativo, baixar a imagem ou copiar o
link. Nenhuma mensagem é enviada automaticamente. O PNG indica que o conteúdo
é um relato e o link permite conferir o contexto e as atualizações posteriores.
Imagens já compartilhadas não se atualizam quando um caso muda de situação.

O Story usa a foto do perfil vinculado ao TikTok, com busca restrita ao bucket
público de avatares e tamanho/tempo limitados. Se a foto não estiver disponível,
mostra a inicial do perfil com indicação de foto indisponível. O arquivo mantém
a informação de relato sujeito a contestação. A assinatura já cadastrada no
rodapé, @jose027._, aparece discretamente no cabeçalho e no cartão, sem animação.

### Fidelidade da arte de compartilhamento

O fundo, logo, moldura e textos fixos do Story vêm da arte aprovada em
`story-approved-v1.webp`. O navegador compõe somente foto, categoria, arroba,
situação e data por cima dessa base, preservando a identidade visual. A foto é
a do perfil público vinculado; uma falha usa a inicial, sem inventar um rosto.
Se a base não carregar, o cartão pede nova tentativa em vez de trocar de estilo.
A publicação compara tanto o HTML quanto os bytes da arte. O teste de navegador
confere pixels nas áreas fixas da imagem exportada e o uso da foto real.

## Coletor com navegador

O worker separado em [`collector/`](collector/README.md) usa TikTok-Api e TikTokPy
como alternativas, com fila privada e autenticação GitHub OIDC. Ele complementa
a consulta direta existente, sem mudar a moderação ou o layout público.
