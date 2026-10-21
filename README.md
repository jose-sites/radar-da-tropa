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
