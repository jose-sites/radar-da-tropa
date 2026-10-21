# Radar Coletor

Coletor separado do site, usando **TikTok-Api 7.3.3** como primeira opção e
**TikTokPy 0.2.4.post2** como alternativa. As duas bibliotecas estão instaladas;
a segunda só consulta quando a primeira falha. Um bloqueio explícito, CAPTCHA,
HTTP 429 ou identidade diferente interrompe as alternativas. Nenhuma biblioteca
é API oficial do TikTok e nenhuma garante acesso.

## Execução

`.github/workflows/tiktok-collector.yml` roda em executor Ubuntu do GitHub Actions,
com Chromium/Playwright. Não depende do computador do proprietário e não roda no
Cloudflare Pages. A rotina está programada a cada 15 minutos; o GitHub pode atrasar
ou descartar execuções agendadas em períodos de carga. Não é uma promessa de
confirmação imediata. As consultas diretas do Radar após o cadastro continuam ativas.

Cada execução reserva até três relatos **publicados e ainda sem perfil**. Reservas
expiram em dez minutos e são protegidas por comparação do número de tentativas.
Cada biblioteca tem orçamento de 35 segundos por perfil, sem sobreposição de
execuções. Há pausa de três segundos entre alternativas e cinco entre perfis.
Falhas aguardam 15 minutos, 30 minutos, uma hora etc., até o máximo de 24 horas.
Apenas ID permanente completo em formato textual e arroba correspondente podem
ser vinculados. A foto é opcional e passa pela validação/cache já existente no
servidor. Identificar uma conta não valida o conteúdo de uma denúncia.

O coletor não atualiza periodicamente perfis já vinculados; essa atualização
continua na rotina existente do Radar. Não solicita vídeos, seguidores ou provas.
TikTokPy usa o formato antigo SIGI_STATE e pode falhar quando esse formato não
estiver disponível. Os erros ficam registrados na fila, sem falsa confirmação.

## Autenticação e privacidade

Não é necessário copiar chave administrativa do Supabase para o GitHub. O worker
pede um token GitHub OIDC de curta duração, validado por assinatura RS256, emissor,
audiência, idade máxima, IDs imutáveis do repositório/proprietário, workflow exato,
branch main e tipo de evento. Pull requests, forks e outros workflows não recebem
acesso. A capacidade permite somente reservar pendências públicas e devolver dados
de perfil para a reserva válida; não publica nem modera denúncias.

Metadados `browser_*` são privados na tabela com RLS já existente. O worker não
imprime tokens, cookies, corpos de páginas ou dados de sessões. Logs exibem só
quantidades consultadas, identificadas e indisponíveis. Dependências estão fixadas
em `requirements.txt`; licenças dos upstreams são MIT. Links:
- https://github.com/davidteather/TikTok-Api
- https://github.com/Russell-Newton/TikTokPy

## Testes

```bash
python3 -m unittest discover -s collector -p 'test_*.py'
node --test tests/*.test.mjs
```

Em desenvolvimento, crie um venv fora do repositório e instale as dependências.
`RADAR_BROWSER_EXECUTABLE` pode selecionar um Chromium já instalado. O proxy HTTP
configurado no ambiente é preservado. Não há solver de CAPTCHA, rotação de proxies
ou credenciais TikTok configuradas pelo Radar.

O teste unitário com respostas simuladas não comprova disponibilidade real do
TikTok. Verifique os números da execução no GitHub e `browser_error` no banco.
Se ambas as bibliotecas falharem, o perfil permanece pendente. O plano atual usa
GitHub-hosted Actions em repositório público; conferir limites/custos antes de
migrar para repositório privado, runners pagos ou aumentar a frequência.
