# GUIA PASSO A PASSO - Robô Macroindicadores SMS Rio

Este guia explica a instalação e a primeira execução. A automação agora está configurada para as planilhas oficiais. Portanto, faça a primeira consulta em modo `conferir`, que não grava dados.

## 1. Fontes oficiais configuradas

### Planilhas Google Sheets

- [NOVO MACROINDICADORES HOSPITAIS - COMPLETO (MENSAL)](https://docs.google.com/spreadsheets/d/1Wb84Wd3yoxHMHuWaPUR_ecONa6NmV-Kge597Kr8vFYQ/edit)
- [NOVO MACROINDICADORES MATERNIDADES - COMPLETO (MENSAL)](https://docs.google.com/spreadsheets/d/1HTSos3enpDTIDG2e3SrAFHIj-0mCf-II7PkSCU9wSAI/edit)

### Backups

- Computador: `C:\Users\15407850761\Documents\Backup do macro indicadores`
- [Pasta principal dos anos no Google Drive](https://drive.google.com/drive/folders/1vlZzgJYNg_PC1yvVuCU1Df97xJjksTS0)
- [Pasta existente do ano de 2026](https://drive.google.com/drive/folders/1ybH9VR4oq356N1Hg9ebNXdS7JEi735Q8)

Para 2027 e anos seguintes, não é necessário criar as pastas manualmente. O robô procura ou cria o ano dentro da pasta principal e depois procura ou cria a pasta `Mês Ano - Robo` dentro daquele ano.

## 2. Programas necessários

Antes da instalação, confirme:

1. Node.js 20 ou superior instalado.
2. Acesso ao SMS Rio.
3. Acesso de edição às duas planilhas oficiais.
4. Acesso à pasta principal de backup do Google Drive.
5. Arquivo de credencial OAuth do Google disponível em `segredos\credentials.json`.

Para conferir o Node.js, abra o PowerShell e execute:

```powershell
node --version
```

## 3. Instalar o robô

1. Abra a pasta do projeto.
2. Clique duas vezes em `instalar.bat`.
3. Aguarde a instalação das dependências e do Chromium.
4. Se a janela informar que terminou, pressione uma tecla para fechar.

O Chromium pode demorar alguns minutos na primeira instalação. Chocolatey não é necessário para executar o robô se o Node.js já estiver instalado corretamente.

## 4. Autorizar o Google

Esta etapa normalmente é feita uma única vez por usuário do Windows.

1. Confirme que existe `segredos\credentials.json`.
2. Clique duas vezes em `autorizar-google.bat`.
3. Entre na conta Google que possui acesso às planilhas oficiais e ao Drive.
4. Autorize Google Sheets e Google Drive.
5. Aguarde a confirmação no terminal.

O arquivo `segredos\token.json` será criado localmente. Não envie os arquivos da pasta `segredos` por e-mail ou WhatsApp.

## 5. Primeira consulta obrigatória após a migração

A troca das planilhas piloto pelas oficiais exige uma nova consulta para que logs, relatório e painel passem a refletir as bases corretas.

Faça primeiro um teste de uma unidade:

1. Clique duas vezes em `executar.bat`.
2. Informe a competência desejada, por exemplo `2026-07`.
3. Em modo, digite `conferir`.
4. Em navegador, escolha `visivel`.
5. Em categoria, digite `Geral`.
6. Em sigla, digite `HMAS`.
7. Quando o Chromium abrir, faça login e resolva o CAPTCHA se for solicitado.
8. Aguarde a mensagem final no terminal.
9. Abra o relatório HTML gerado e confira o resultado.

Depois desse teste, execute novamente em modo `conferir` para todas as unidades:

```text
Competência: AAAA-MM
Modo: conferir
Navegador: visivel
Categorias: todos
Siglas: todos
```

Somente use `atualizar` depois de revisar a conferência das planilhas oficiais.

## 6. Como responder às perguntas do executar.bat

### Competência

Use `AAAA-MM`. Exemplos:

- janeiro de 2026: `2026-01`
- julho de 2026: `2026-07`
- janeiro de 2027: `2027-01`

### Modo

- `conferir`: baixa, salva e compara; não altera o Google Sheets.
- `atualizar`: grava a competência selecionada conforme as regras de segurança.
- `2 - atualizar pendências`: preenche células vazias e zeros suspeitos; não substitui valores já preenchidos.
- `3 - atualizar completo`: sincroniza também os valores já preenchidos que foram corrigidos no SMS Rio.

Em ambos os casos, somente a competência informada é gravada. Os seis meses anteriores são consultados apenas para classificar zeros e nunca são alterados. O relatório visual é salvo como um único arquivo HTML em `relatorios\AAAA-MM` e mostra somente a situação observada na plataforma SMS Rio: dentro do prazo até o dia 5, pendente a partir do dia 6 e alterações após o marco do dia 10.

Na primeira tabela do relatório, cada unidade apresenta quantos indicadores estão preenchidos, quantos são pendentes pelo histórico, quantos mudaram desde a última consulta e quantos foram alterados após o dia 10. Clique nos números coloridos para abrir os nomes e valores. O botão de pendências fica amarelo enquanto a unidade ainda está no prazo e vermelho a partir do dia 6. A classificação é conservadora: valor atual vazio ou zero, mês imediatamente anterior preenchido e pelo menos três dos últimos seis meses com valor diferente de zero.

### Navegador

- `visivel` (padrão): abre o Chromium. Escolha na primeira execução, se aparecer login ou quando for necessário resolver o CAPTCHA.
- `2 - segundo-plano`: executa sem janela enquanto a sessão permitir. Se for necessário login, abre o Chromium para o CAPTCHA e o mantém minimizado durante a consulta, pois fechar a janela encerra a sessão temporária do portal.

Se a sessão expirar, a mesma execução abre o modo visível. Depois do login, a janela é minimizada e o processamento continua automaticamente. O CAPTCHA permanece manual.

### Categorias

Use `Geral`, `Pediatria`, `Maternidade` ou `todos`. Também é possível informar mais de uma separada por vírgula.

### Siglas

Use uma sigla, várias separadas por vírgula ou `todos`. Exemplos: `HMAS`, `HMAS,HMMC` ou `todos`.

## 7. O que acontece em cada unidade

O robô:

1. faz uma pré-verificação rápida pelo mesmo serviço utilizado pela tela do SMS Rio;
2. identifica quais unidades possuem a competência solicitada;
3. abre o relatório mensal somente para as unidades que precisam de exportação;
4. escolhe a categoria, a unidade e o ano;
5. pesquisa a competência;
6. exporta o Excel oficial;
7. confirma que a competência escolhida existe no arquivo anual;
8. salva o arquivo no computador;
9. envia o arquivo ao Google Drive;
10. compara SMS Rio e Google Sheets;
11. aplica ou não a atualização, conforme o modo;
12. registra zeros, dados novos, divergências e erros.

Se a competência ainda não existir no SMS Rio, o robô informa a unidade como pendente. Nesse caso, não salva um Excel daquele mês e não altera a planilha.

Se a pré-verificação rápida ficar indisponível ou retornar um formato inesperado, o robô não interrompe a execução: ele volta automaticamente ao fluxo visual tradicional para aquela consulta.

## 8. Organização dos backups

### No computador

Todos os arquivos ficam em:

```text
C:\Users\15407850761\Documents\Backup do macro indicadores
```

O nome contém unidade, categoria, competência e data de extração para evitar confusão entre unidades de mesma sigla em categorias diferentes.

### No Google Drive

Estrutura esperada:

```text
Pasta principal
├── 2026
│   ├── Janeiro 2026 - Robo
│   ├── Fevereiro 2026 - Robo
│   └── ...
├── 2027
│   ├── Janeiro 2027 - Robo
│   └── ...
└── próximos anos
```

A pasta de 2026 já existe. A partir de 2027, a criação é automática.

## 9. Relatório, painel e histórico

Cada execução gera:

- um log técnico em `logs`;
- um relatório HTML em `relatorios`;
- atualização do dashboard em `painel`.

Depois da migração, os arquivos antigos continuam representando o piloto. Eles não devem ser usados como prova da situação atual das planilhas oficiais. Uma nova execução em `conferir` cria o primeiro registro oficial.

## 10. Como interpretar os resultados

- **Com dados lançados:** a competência foi localizada no SMS Rio.
- **Pendente de preenchimento:** a unidade foi localizada, mas a competência ainda não existe.
- **Não localizada:** o nome configurado não foi encontrado na plataforma.
- **Erro técnico:** a consulta ou validação não terminou corretamente.
- **Indicador zerado:** o SMS Rio devolveu zero; pode ser pendência ou indicador não aplicável.
- **Divergência Sheets x SMS:** a planilha possui um valor e a plataforma apresenta outro.
- **Dado novo:** o SMS Rio possui valor e a célula correspondente da planilha estava vazia.

## 11. Cuidados antes de atualizar

1. Confira se a competência está correta.
2. Confira se o relatório indica as planilhas oficiais.
3. Verifique divergências e unidades sem competência.
4. Guarde o relatório da conferência.
5. Use `atualizar` somente quando tiver certeza de que deseja gravar.
6. Nunca exclua `segredos`, `logs` ou os arquivos de backup para tentar corrigir um erro.

## 12. Problemas comuns

### Chromium fecha ou o terminal mostra timeout

Leia a última mensagem do terminal e execute novamente. Se o SMS Rio estiver lento, faça primeiro uma unidade. No modo `visivel`, não feche o Chromium enquanto o robô estiver trabalhando.

### Login ou CAPTCHA

Execute no modo `visivel`. O robô preenche as credenciais e clica em `Entrar` automaticamente quando a verificação estiver pronta. Se aparecer `Confirme que é humano`, marque somente a caixa; não é necessário clicar em `Entrar`. Depois aguarde o robô continuar.

### Google pede autorização novamente

Execute `autorizar-google.bat`. Se persistir, confirme se a conta possui acesso às duas planilhas oficiais e à pasta principal do Drive.

### Aba ausente ou nome diferente

Não renomeie a aba sem conferir `config\unidades.json`. A sigla correta da Maternidade Mariska Ribeiro é `HMMR`.

### A pasta de backup local não existe

O robô cria `C:\Users\15407850761\Documents\Backup do macro indicadores` automaticamente na primeira extração.

## 13. Checklist final

- [ ] Node.js instalado.
- [ ] Google autorizado.
- [ ] Planilhas oficiais abertas pela conta correta.
- [ ] Pasta principal do Drive acessível.
- [ ] Primeira unidade conferida sem gravação.
- [ ] Todas as unidades conferidas sem gravação.
- [ ] Relatório oficial revisado.
- [ ] Atualização liberada, se necessária.

Para a rotina normal, consulte também [MANUAL-DE-UTILIZACAO-DO-ROBO.md](MANUAL-DE-UTILIZACAO-DO-ROBO.md).
