# Robô Macroindicadores SMS Rio

Automação local com Playwright para consultar o relatório mensal do SMS Rio, guardar os arquivos de origem, conferir diferenças e, somente quando autorizado, atualizar as planilhas oficiais do Google Sheets.

## Ambiente oficial configurado

- Hospitais: [NOVO MACROINDICADORES HOSPITAIS - COMPLETO (MENSAL)](https://docs.google.com/spreadsheets/d/1Wb84Wd3yoxHMHuWaPUR_ecONa6NmV-Kge597Kr8vFYQ/edit)
- Maternidades: [NOVO MACROINDICADORES MATERNIDADES - COMPLETO (MENSAL)](https://docs.google.com/spreadsheets/d/1HTSos3enpDTIDG2e3SrAFHIj-0mCf-II7PkSCU9wSAI/edit)
- Pasta principal do Drive: [Backup - Plataforma SMS Rio](https://drive.google.com/drive/folders/1vlZzgJYNg_PC1yvVuCU1Df97xJjksTS0)
- Pasta de 2026: [2026](https://drive.google.com/drive/folders/1ybH9VR4oq356N1Hg9ebNXdS7JEi735Q8)
- Backup local: `C:\Users\15407850761\Documents\Backup do macro indicadores`

O ano de 2026 utiliza a pasta já existente. Para 2027 e anos seguintes, o robô cria automaticamente a pasta do ano dentro da pasta principal e, nela, a pasta `Mês Ano - Robo`.

## O que o robô faz

- Permite escolher entre navegador visível e execução em segundo plano.
- No modo visível, preenche as credenciais e clica em `Entrar` automaticamente quando o Cloudflare estiver ausente ou validado. Se a confirmação humana aparecer, o usuário marca somente a caixa e o robô continua.
- Consulta as categorias Geral, Pediatria e Maternidade conforme `config/unidades.json`.
- Usa um fluxo híbrido: consulta rapidamente o serviço da própria tela para identificar as competências disponíveis e volta ao fluxo visual se essa consulta falhar.
- Exporta o `.xls` oficial somente para unidades/anos que tenham ao menos uma das competências solicitadas.
- Salva o arquivo no computador e no Google Drive somente quando a competência escolhida estiver disponível no SMS Rio.
- Relaciona os indicadores por grupo e nome, sem depender apenas da posição da linha.
- Confere valores, zeros, dados novos e divergências entre SMS Rio e Google Sheets.
- Nos dois modos de atualização, grava somente a competência solicitada; os seis meses anteriores são sempre somente leitura.
- Mantém competências anteriores em leitura e informa qualquer alteração encontrada.
- Gera log, relatório HTML e atualiza o painel local.

## Modos disponíveis

- `1 - conferir`: consulta e compara, mas não grava valores no Google Sheets.
- `2 - atualizar`: preenche células vazias da competência e trata divergências conforme as travas do projeto.
- `2 - atualizar pendências`: preenche células vazias e zeros suspeitos, preservando valores já preenchidos.
- `3 - atualizar completo`: sincroniza também correções feitas pela unidade em valores já preenchidos.
- Percentuais e taxas por mil são gravados com escala e formato próprios; fórmulas são preservadas.
- Cada execução gera um relatório visual HTML exclusivo da plataforma SMS Rio, organizado por competência e pronto para ser compartilhado como um único arquivo.
- A primeira tabela mostra, por unidade, indicadores preenchidos, pendentes pelo histórico recente, alterações desde a última consulta e alterações após o dia 10. Os números coloridos abrem o detalhamento. O botão de pendências fica amarelo até o fim do prazo e vermelho a partir do dia 6.
- Uma pendência provável exige valor atual vazio ou zero, mês anterior preenchido e pelo menos três dos últimos seis meses com valor diferente de zero. Assim, um zero isolado não é tratado automaticamente como erro.
- O relatório distingue unidades dentro do prazo (até o dia 5), pendentes (a partir do dia 6) e alterações detectadas após o marco do dia 10.

Depois da troca das planilhas piloto pelas oficiais, a primeira execução deve ser sempre no modo `conferir`.

## Instalação e uso

1. Execute `instalar.bat` somente na primeira instalação ou após trocar de computador.
2. Execute `autorizar-google.bat` se a conta ainda não tiver sido autorizada.
3. Execute `executar.bat` para iniciar uma consulta.
4. Informe a competência no formato `AAAA-MM`.
5. Escolha o modo, o tipo de navegador e, se desejar, filtre categoria ou sigla.

### Escolha do navegador

- `visivel` (padrão): abre o Chromium e é obrigatório na primeira execução, quando a sessão expira ou quando houver CAPTCHA.
- `2 - segundo-plano`: não abre janela enquanto a sessão permitir. Se o SMS Rio pedir login, o navegador abre para o CAPTCHA e permanece minimizado durante a consulta, pois fechar a janela encerra a sessão temporária do portal.

Leia [GUIA-PASSO-A-PASSO.md](GUIA-PASSO-A-PASSO.md) para instalação e [MANUAL-DE-UTILIZACAO-DO-ROBO.md](MANUAL-DE-UTILIZACAO-DO-ROBO.md) para a rotina mensal.

## Arquivos importantes

- `config/config.json`: planilhas oficiais, pastas do Drive e backup local.
- `config/unidades.json`: categoria, aba, nome e termo de busca de cada unidade.
- `segredos/credentials.json` e `segredos/token.json`: autorização do Google; não compartilhar.
- `perfil-navegador`: sessão local do SMS Rio; não compartilhar.
- `logs`: histórico técnico das execuções.
- `relatorios`: relatórios HTML de cada execução.
- `painel`: dashboard atualizado pelas execuções.

## Segurança operacional

- O CAPTCHA não é contornado.
- O arquivo exportado precisa estar salvo localmente e no Drive antes de qualquer gravação no Sheets.
- Uma competência ausente no SMS Rio é apenas informada; não gera arquivo nem atualização.
- A consulta rápida nunca substitui o arquivo de origem: ela serve apenas para evitar abrir e baixar relatórios sabidamente indisponíveis.
- Zero é um valor válido e precisa ser analisado, pois pode ser pendência ou indicador não aplicável.
- Indicador faltante ou extra bloqueia a atualização daquela unidade.
- Nunca compartilhe a pasta `segredos`, o token do Google ou o perfil do navegador.
- A sigla da Maternidade Mariska Ribeiro está configurada como `HMMR`.

Psiquiatria permanece fora do escopo até que suas planilhas e abas sejam configuradas.
