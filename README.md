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
