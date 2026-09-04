# Robô Macroindicadores SMS Rio

Automação local para baixar os relatórios mensais do SMS Rio, manter backups e atualizar as planilhas do Google com controle de segurança.

## O que esta versão faz

- Abre o SMS Rio com Playwright em uma janela real do Chromium.
- Aguarda o usuário fazer login e resolver o CAPTCHA.
- Processa Geral (19 unidades), Pediatria (3) e Maternidade (14).
- Exporta um `.xls` por unidade para a pasta Downloads.
- Nomeia o arquivo como `SIGLA - CATEGORIA - Mês Ano - DD-MM-AAAA.xls` para evitar colisões entre HMAS Geral e HMAS Maternidade.
- Cria ou reutiliza no Drive a pasta `Mês Ano - Robo`.
- Envia o backup ao Drive antes de acessar ou atualizar a planilha.
- Relaciona os indicadores por `Grupo + Campo`, nunca pela posição cega da linha.
- Atualiza somente a competência informada.
- Compara os dois meses anteriores e registra todas as diferenças, sem alterá-los.
- Reabre os valores gravados e exige zero divergências para considerar a unidade concluída.
- Produz um log JSON completo na pasta `logs`.

Se o download, o upload, o mapeamento ou qualquer validação falhar, a unidade recebe `ERRO_SEM_ATUALIZAR`.

## Instalação

Pré-requisito: Node.js 20 ou superior.

1. Execute `instalar.bat`.
2. Crie a credencial OAuth do Google conforme a seção abaixo.
3. Execute `autorizar-google.bat` uma vez.
4. Execute `executar.bat`.

## Configuração do Google

No Google Cloud:

1. Crie ou selecione um projeto.
2. Ative **Google Drive API** e **Google Sheets API**.
3. Configure a tela de consentimento OAuth e inclua a conta que executará o robô como usuário de teste, se o aplicativo estiver em modo de teste.
4. Em **Google Auth platform > Clients**, crie um cliente OAuth do tipo **Desktop app**.
5. Baixe o JSON, crie a pasta `segredos` neste projeto e salve o arquivo como `segredos\credentials.json`.
6. Execute `autorizar-google.bat` e autorize com a conta que possui as planilhas e a pasta de backups.

As credenciais e o token ficam somente no computador e são ignorados pelo Git.

Documentação oficial: https://developers.google.com/workspace/guides/create-credentials

## Uso

O arquivo `executar.bat` solicita:

- Competência: `AAAA-MM`, por exemplo `2026-06`.
- Modo:
  - `conferir`: baixa, faz backup e compara, mas não escreve no Sheets.
  - `atualizar`: executa as mesmas travas e grava somente a competência escolhida.
- Categorias opcionais: `Geral`, `Pediatria`, `Maternidade`.
- Unidades opcionais: siglas como `HMAS,HMMC`.

Para o primeiro teste local, use:

```text
Competência: 2026-06
Modo: conferir
Categorias: Geral
Unidades: HMAS
```

Só depois de analisar o log execute novamente com `Modo: atualizar`.

## Arquivos de configuração

- `config/config.json`: URLs, IDs das planilhas, pasta do Drive e caminhos locais.
- `config/unidades.json`: categoria, planilha, aba e termo de busca de cada unidade.

Abas iniciadas por `CONSOLIDADO` não fazem parte da lista de unidades. A sigla oficial da maternidade Mariska Ribeiro está configurada como `HMMMR`.

## Segurança operacional

- O CAPTCHA nunca é contornado: deve ser resolvido manualmente.
- Competências anteriores são somente leitura.
- Zeros são valores válidos e aparecem na contagem do log.
- Indicador faltante ou extra bloqueia a atualização daquela unidade.
- Nenhuma senha do SMS Rio é salva pelo código; apenas o perfil persistente do navegador permanece localmente.
- Não compartilhe a pasta `segredos` nem o diretório `perfil-navegador`.

## Escopo ainda não configurado

Psiquiatria será incluída quando a planilha e as abas correspondentes forem informadas.
