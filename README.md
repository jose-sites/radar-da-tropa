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
As duas funções precisam da chave de serviço como segredo do projeto; a
segunda também usa `FETCHLAYER_API_KEY`. Nenhum desses segredos vai para o
HTML público.

Fotos anexadas ficam privadas até o administrador visualizá-las e publicar
uma cópia recriada sem metadados. Vídeos permanecem privados e ainda não têm
remoção automática de metadados. A publicação e retirada de prova são ações
do painel administrativo. Recursos com e-mail opcional podem ser localizados
manualmente se o protocolo for perdido.
