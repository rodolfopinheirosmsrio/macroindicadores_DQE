# MANUAL DE UTILIZAÇÃO DO ROBÔ MACROINDICADORES

O robô utiliza fluxo híbrido: login e confirmação pela interface do SMS Rio, pré-verificação rápida pelo serviço da própria tela e exportação do XLS oficial apenas quando necessária. Se a parte rápida falhar, o método visual anterior é retomado automaticamente.

## 1. Finalidade

O robô acompanha o preenchimento mensal dos Macroindicadores do SMS Rio, mantém o arquivo original de cada consulta, compara os dados com o Google Sheets e registra o histórico necessário para análise da SUBHUE.

Este manual trata da rotina de uso. Para instalar ou autorizar o Google, consulte `GUIA-PASSO-A-PASSO.md`.

## 2. Fontes utilizadas

- SMS Rio: relatório mensal dos Macroindicadores.
- Google Sheets oficial de hospitais e pediatria.
- Google Sheets oficial de maternidades.
- Google Drive oficial para os arquivos exportados.
- Pasta local `C:\Users\15407850761\Documents\Backup do macro indicadores`.

## 3. Rotina recomendada do mês

Como o marco mensal fecha no dia 10, recomenda-se:

1. Antes do dia 10, executar `conferir` para acompanhar quem já lançou.
2. No dia 10 ou depois, executar `conferir` para todas as unidades.
3. Analisar unidades pendentes, não localizadas, erros e divergências.
4. Solicitar correções às unidades quando necessário.
5. Repetir `conferir` para verificar as correções.
6. Usar `2 - atualizar pendências` ou `3 - atualizar completo` somente após validar o relatório de conferência.
7. Guardar o relatório final como evidência do fechamento.

## 4. Iniciar o robô

1. Abra a pasta `smsrio-macro-robo`.
2. Clique duas vezes em `executar.bat`.
3. Informe a competência no formato `AAAA-MM`.
4. Informe o modo.
5. Escolha o navegador: `visivel` ou `segundo-plano`.
6. Informe a categoria ou `todos`.
7. Informe a sigla da unidade ou `todos`.
8. No modo `visivel`, faça login no SMS Rio e resolva o CAPTCHA se a tela solicitar.
9. No modo `visivel`, não feche o Chromium. Aguarde o robô terminar.

## 5. Escolher o modo correto

| Modo | O que faz | Quando usar |
|---|---|---|
| `1 - conferir` | Compara SMS Rio e Google Sheets sem gravar | Sempre como primeira etapa |
| `2 - atualizar pendências` | Preenche vazios e zeros suspeitos | Quando deseja preservar tudo o que já estava preenchido |
| `3 - atualizar completo` | Sincroniza também valores já preenchidos que foram corrigidos | Quando deseja substituir a fotografia anterior da competência pela versão atual do SMS Rio |

Os seis meses anteriores são lidos para analisar zeros, mas nunca são alterados. Fórmulas são preservadas. O relatório visual interativo é salvo como um único arquivo HTML em uma subpasta da competência, por exemplo `relatorios\2026-08`. Ele apresenta somente a plataforma SMS Rio: unidades com dados, dentro do prazo até o dia 5, pendentes a partir do dia 6, novos preenchimentos e alterações após o marco do dia 10.

A tabela inicial funciona como leitura rápida. Para cada unidade, ela mostra:

- quantidade de indicadores preenchidos em relação ao total esperado;
- quantidade de indicadores pendentes pelo histórico dos últimos seis meses;
- quantidade de indicadores alterados desde a última consulta comparável;
- quantidade de indicadores alterados após o marco do dia 10.

Os números amarelos, vermelhos e azuis são clicáveis e abrem uma janela compacta com os nomes, valores e datas. O botão de pendências fica amarelo até o dia 5 e vermelho a partir do dia 6. O relatório não repete abaixo uma tabela extensa: todo o detalhamento fica nas janelas abertas pelos números.

O modo `conferir` também gera relatório e atualiza o painel com a fotografia daquela execução.

## 5.1 Escolher o navegador

| Navegador | O que faz | Quando usar |
|---|---|---|
| `visivel` | Abre o Chromium e permite login manual e CAPTCHA | Primeira execução, sessão expirada ou sempre que quiser acompanhar a consulta |
| `2 - segundo-plano` | Roda oculto enquanto a sessão permitir; se precisar de login, abre o Chromium e o mantém minimizado | Para deixar a consulta discreta sem perder a possibilidade de resolver o CAPTCHA |

O CAPTCHA nunca é automatizado. O robô preenche as credenciais e clica em `Entrar` quando o Cloudflare estiver ausente ou já validado. Se aparecer `Confirme que é humano`, marque somente essa caixa. Depois do acesso, o navegador é minimizado e a execução continua automaticamente.

## 6. Exemplos

### Conferir apenas HMAS Geral

```text
Competência: 2026-07
Modo: conferir
Navegador: visivel
Categorias: Geral
Siglas: HMAS
```

### Conferir todas as unidades

```text
Competência: 2026-07
Modo: conferir
Categorias: todos
Siglas: todos
```

### Conferir todas as maternidades

```text
Competência: 2026-07
Modo: conferir
Categorias: Maternidade
Siglas: todos
```

### Atualizar somente valores anteriormente zerados

```text
Competência: 2026-07
Modo: 2 (atualizar pendências)
Categorias: todos
Siglas: todos
```

## 7. Onde ficam os resultados

### Arquivos originais do SMS Rio

- Computador: `C:\Users\15407850761\Documents\Backup do macro indicadores`
- Google Drive: pasta do ano e, dentro dela, `Mês Ano - Robo`.

### Relatório da execução

Fica na pasta `relatorios` do projeto. Abra o arquivo HTML com data e horário da execução.

### Painel

Fica na pasta `painel`. O arquivo principal é `painel-dashboard.html`.

### Log técnico

Fica na pasta `logs`. É útil para descobrir a causa de um erro.

## 8. Significado dos principais resultados

| Resultado | Significado | Ação recomendada |
|---|---|---|
| Com dados lançados | A competência existe no SMS Rio | Conferir zeros e divergências |
| Pendente de preenchimento | Unidade localizada, mas mês ausente | Cobrar lançamento e consultar novamente |
| Não localizada no SMS Rio | Nome configurado não apareceu na busca | Conferir nome da unidade e categoria |
| Erro técnico | A consulta não terminou corretamente | Ler o erro, corrigir e repetir |
| Dado novo | SMS tem valor e Sheets estava vazio | Validar antes de atualizar |
| Divergência Sheets x SMS | As duas fontes têm valores diferentes | Investigar qual é o valor correto; não sobrescrever sem análise |
| Indicador zerado | SMS devolveu zero | Avaliar histórico e aplicabilidade do indicador |

## 9. Como analisar indicadores zerados

Um zero não significa automaticamente erro. Ele pode indicar:

- atividade que a unidade não realiza;
- indicador que não se aplica àquela unidade;
- ausência de produção no mês;
- lançamento ainda pendente;
- correção futura pela unidade.

Use o histórico do painel. Se o indicador tinha valor diferente de zero em meses anteriores e passou a zero, trate como possível pendência e confirme com a unidade.

No relatório, a classificação automática é mais conservadora: o valor atual precisa estar vazio ou zerado, o mês imediatamente anterior precisa estar preenchido e pelo menos três dos últimos seis meses precisam ter valor diferente de zero. Isso reduz falsos alertas em indicadores que normalmente não se aplicam à unidade.

## 10. Como tratar divergências

1. Abra o detalhamento da unidade no relatório ou painel.
2. Confira competência, indicador, valor do Google Sheets e valor do SMS Rio.
3. Verifique se houve retificação na plataforma depois do fechamento.
4. Registre a justificativa da mudança.
5. Não altere competências anteriores automaticamente, pois os dados podem já ter sido usados em respostas ao Gabinete.
6. Se for necessário corrigir o histórico, faça isso somente após autorização e mantenha a evidência da alteração.

## 11. Unidades sem competência

Quando a competência não existe no SMS Rio:

- o robô não deve salvar um Excel daquele mês;
- o robô não deve atualizar a planilha;
- a unidade aparece na lista de pendentes;
- a consulta deve ser repetida depois do lançamento.

Essa regra vale para qualquer mês e ano.

## 12. Backups no Google Drive

O robô utiliza esta organização:

```text
Pasta principal dos anos
└── ano
    └── Mês Ano - Robo
        └── arquivos das unidades
```

Em 2026, utiliza a pasta de ano já existente. A partir de 2027, cria o ano automaticamente se ainda não existir.

## 13. Cuidados essenciais

- Sempre confira a competência antes de iniciar.
- Use `conferir` antes de qualquer atualização.
- No modo `visivel`, não feche o navegador durante a execução.
- Não edite ou exclua o Excel enquanto o robô estiver trabalhando.
- Não compartilhe a pasta `segredos` ou o perfil do navegador.
- Não use relatórios do piloto como situação atual das planilhas oficiais.
- Não corrija meses anteriores sem autorização e registro da justificativa.

## 14. Se o robô parar

1. Leia a última mensagem do terminal.
2. Anote a unidade em que parou.
3. Abra o log mais recente em `logs`.
4. Repita em modo `conferir` apenas para a unidade afetada.
5. Se o problema persistir, envie o texto do erro e uma captura da tela, sem mostrar senha ou token.

## 15. Checklist de fechamento

- [ ] Todas as categorias previstas foram consultadas.
- [ ] Quantidade de unidades com dados foi registrada.
- [ ] Pendentes e não localizadas foram identificadas.
- [ ] Erros técnicos foram resolvidos.
- [ ] Zeros suspeitos foram analisados.
- [ ] Divergências Sheets x SMS foram justificadas.
- [ ] Backups local e no Drive foram confirmados.
- [ ] Relatório final foi guardado.
- [ ] Data e horário da última verificação aparecem no painel.
