# Guia completo para instalar e executar o Robô SMS Rio

Este guia foi escrito para quem está fazendo esse tipo de instalação pela primeira vez. Siga na ordem e não pule diretamente para o modo `atualizar`.

## 1. Finalizar a instalação do Node.js

A mensagem abaixo é normal:

```text
Forcing web requests to allow TLS v1.2
Getting Chocolatey...
Installing Chocolatey...
```

Ela indica que o instalador está preparando o Chocolatey e ferramentas auxiliares. Não feche a janela enquanto ainda estiver aparecendo atividade.

Quando o processo terminar e o cursor do PowerShell voltar a aceitar comandos:

1. Feche essa janela do PowerShell.
2. Feche também outras janelas do PowerShell ou Prompt de Comando.
3. Abra um **novo PowerShell**, sem precisar usar “Executar como administrador”.
4. Execute:

```powershell
node -v
npm.cmd -v
```

Resultados esperados:

```text
v20... ou superior
10... ou superior
```

Os números exatos podem ser diferentes. O importante é ambos responderem com uma versão.

Se aparecer “node não é reconhecido”:

1. Reinicie o computador.
2. Abra outro PowerShell.
3. Repita `node -v` e `npm.cmd -v`.

Se somente `npm` apresentar uma mensagem sobre política de execução, use `npm.cmd`, como mostrado acima. Não altere a política do PowerShell apenas por causa deste projeto.

## 2. Copiar o projeto para o computador

Use o arquivo `smsrio-macro-robo.zip` fornecido junto deste guia.

1. Abra a pasta Downloads.
2. Clique com o botão direito em `smsrio-macro-robo.zip`.
3. Escolha **Extrair Tudo**.
4. Escolha como destino a pasta Documentos.
5. Ao terminar, abra a pasta extraída `smsrio-macro-robo`.

Dentro dela devem aparecer imediatamente:

```text
config
src
test
instalar.bat
autorizar-google.bat
executar.bat
package.json
```

Se existir uma pasta `smsrio-macro-robo` dentro de outra pasta com o mesmo nome, use a pasta interna, onde está o `package.json`.

Evite colocar o projeto em uma pasta sincronizada publicamente ou compartilhada, pois posteriormente ele conterá credenciais locais.

## 3. Instalar as bibliotecas do robô

1. Dentro da pasta `smsrio-macro-robo`, dê dois cliques em `instalar.bat`.
2. Uma janela preta será aberta.
3. Aguarde o download das bibliotecas e do navegador Chromium usado pelo Playwright.
4. O processo pode levar vários minutos.
5. No final deve aparecer:

```text
Instalacao concluida.
```

Se o Windows SmartScreen bloquear o arquivo, confirme primeiro que você abriu o arquivo dentro da pasta deste projeto. Depois use **Mais informações > Executar assim mesmo**. Se o nome ou o local do arquivo forem diferentes, cancele.

## 4. Criar o acesso do Google

O robô precisa de autorização para atualizar as duas planilhas e enviar os backups. Ele não precisa da senha da conta Google.

### 4.1 Criar um projeto

1. Acesse https://console.cloud.google.com/.
2. Entre com uma conta que possa criar um projeto Google Cloud.
3. No seletor de projetos, clique em **Novo projeto**.
4. Nome sugerido: `Robo SMSRio`.
5. Clique em **Criar** e selecione o projeto criado.

Não é necessário contratar servidor ou máquina virtual.

### 4.2 Ativar as APIs

1. Abra o menu do Google Cloud.
2. Entre em **APIs e serviços > Biblioteca**.
3. Procure `Google Drive API`.
4. Abra o resultado e clique em **Ativar**.
5. Volte à Biblioteca.
6. Procure `Google Sheets API`.
7. Abra o resultado e clique em **Ativar**.

### 4.3 Configurar a tela de consentimento

1. No menu, abra **Google Auth platform > Branding**.
2. Informe um nome como `Robo SMSRio`.
3. Informe o e-mail solicitado para suporte/contato.
4. Em **Audience**, escolha:
   - **Interno**, se a conta pertence a um Google Workspace da organização e essa opção estiver disponível; ou
   - **Externo**, para uma conta Gmail comum.
5. Se escolher Externo e o aplicativo ficar em modo de teste, adicione `subhueindicadores@gmail.com` em **Test users/Usuários de teste**.

### 4.4 Criar a credencial Desktop

1. Abra **Google Auth platform > Clients**.
2. Clique em **Create client/Criar cliente**.
3. Em tipo de aplicativo, escolha **Desktop app/Aplicativo para computador**.
4. Nome sugerido: `Robo SMSRio Desktop`.
5. Clique em **Criar**.
6. Baixe o arquivo JSON da credencial.

### 4.5 Colocar a credencial no projeto

1. Volte à pasta `smsrio-macro-robo`.
2. Crie uma pasta chamada exatamente `segredos`.
3. Mova o JSON baixado para dentro de `segredos`.
4. Renomeie o arquivo para exatamente:

```text
credentials.json
```

O caminho final deve terminar assim:

```text
smsrio-macro-robo\segredos\credentials.json
```

Não envie esse arquivo por e-mail, WhatsApp ou chat e não o coloque no Google Drive.

## 5. Autorizar a conta Google uma vez

1. Dê dois cliques em `autorizar-google.bat`.
2. O navegador abrirá a página do Google.
3. Escolha a conta que tem acesso às planilhas e à pasta de backup — normalmente `subhueindicadores@gmail.com`.
4. Leia a tela e autorize o acesso solicitado ao Drive e às Planilhas.
5. Aguarde a mensagem:

```text
Autorização do Google concluída e token salvo.
```

O projeto criará `segredos\token.json`. Esse arquivo também é secreto.

Se o Google mostrar um aviso de aplicativo não verificado, prossiga somente se o nome do projeto for o mesmo que você acabou de criar e a conta exibida estiver correta. Caso contrário, cancele.

## 6. Primeiro teste — sem alterar a planilha

1. Dê dois cliques em `executar.bat`.
2. Preencha:

```text
Competência: 2026-06
Modo: conferir
Categorias: Geral
Unidades: HMAS
```

3. O Playwright abrirá uma janela própria do Chromium.
4. Assim que a tela de login terminar de carregar, digite o CPF e a senha normalmente.
5. Resolva o CAPTCHA manualmente e clique para entrar.
6. Não é necessário voltar à janela preta nem pressionar ENTER: o robô detectará o login automaticamente.
7. Aguarde a consulta, o download, o backup no Drive e as comparações. O login pode permanecer aberto por até 15 minutos antes de expirar.

No modo `conferir`:

- o relatório é baixado;
- o backup é enviado ao Drive;
- os valores são comparados;
- nenhuma célula da planilha é alterada.

O resultado detalhado fica na pasta `logs` do projeto.

## 7. Primeiro teste de atualização

Faça esta etapa somente depois de verificar que o teste anterior terminou sem erro.

1. Use apenas uma **cópia de teste** da planilha.
2. Confirme que a competência que será testada está vazia na aba correta.
3. Execute novamente `executar.bat`.
4. Use os mesmos filtros, mas informe:

```text
Modo: atualizar
```

O robô somente considera a unidade concluída se:

1. o arquivo foi salvo localmente;
2. o upload ao Drive foi confirmado;
3. todos os indicadores foram relacionados pelo grupo e pelo nome;
4. somente a competência autorizada foi gravada;
5. a releitura final encontrou zero divergências.

## 8. Como executar depois do piloto

Para conferir todas as unidades de uma categoria, deixe `Unidades` vazio.

Exemplo para todas as unidades do macro Geral:

```text
Competência: 2026-07
Modo: conferir
Categorias: Geral
Unidades:
```

Categorias disponíveis nesta versão:

```text
Geral
Pediatria
Maternidade
```

Psiquiatria será adicionada quando sua planilha e abas forem configuradas.

## 9. Problemas comuns

### `node` não é reconhecido

Feche todos os terminais, reinicie o Windows e confira `node -v` novamente.

### `credentials.json` não encontrado

Confira se o arquivo está em `segredos\credentials.json` e se o Windows não acrescentou `.json` duas vezes.

### O login do Google não permite continuar

Confira se a conta foi adicionada como usuário de teste no Google Auth platform e se Drive API e Sheets API estão ativadas.

### Unidade ou indicador não encontrado

Não force a atualização. Consulte o arquivo mais recente da pasta `logs`. A segurança do robô bloqueia a gravação quando o mapeamento é incerto.

### O SMS Rio pede login outra vez

Isso é esperado quando a sessão expira. Faça o login e o CAPTCHA manualmente; o robô detectará a conclusão e continuará automaticamente.

## 10. Regra mais importante

Execute primeiro em `conferir`. Use `atualizar` somente após revisar o log e sempre comece por uma cópia de teste.
# Login automático protegido

Depois de copiar a atualização, execute `configurar-login.bat` uma única vez e digite a senha quando solicitado. A digitação fica invisível, o que é normal. O Windows protege a senha para o usuário e computador atuais.

Nas execuções seguintes, use `executar.bat`. O robô preencherá CPF e senha; você ainda deve resolver o CAPTCHA e clicar em **Entrar**.

# Conferir várias unidades

No campo de siglas, digite `todos` para executar todas as unidades da categoria escolhida. Exemplo: categoria `Geral` e sigla `todos` confere todas as unidades do macro Geral. Também é possível deixar o campo de siglas vazio.

O modo `conferir` lista os indicadores zerados, todas as diferenças encontradas e, no resumo final, as unidades que não possuem a competência solicitada no SMS Rio.

Quando uma unidade não possui a competência solicitada, o robô apenas a inclui no resumo. Nesse caso ele não baixa Excel, não envia arquivo ao Drive e não altera o Google Sheets.

# Relatório da execução

Ao terminar, o robô cria automaticamente um arquivo HTML na pasta `relatorios`. O nome contém a competência, a data e o horário. Abra o arquivo com dois cliques para consultar o resumo, as unidades atualizadas, indicadores zerados, divergências, meses anteriores, unidades sem competência e erros.

No relatório, **novos dados encontrados** são valores trazidos pelo SMS Rio quando a célula da planilha estava vazia. **Indicadores divergentes** são valores diferentes quando a planilha já possuía algum dado.

O relatório analisa uma janela de seis competências: a competência escolhida e os cinco meses anteriores. Somente a competência escolhida pode ser atualizada; os outros cinco meses são apenas conferidos e nunca alterados.

Para apoiar a análise dos indicadores zerados, o robô consulta uma janela adicional de sete meses. A classificação é indicativa: valor diferente de zero no histórico sugere possível pendência; zero durante toda a janela sugere possível indicador não aplicável; histórico incompleto exige validação manual.

O painel `painel\painel-dashboard.html` é atualizado ao fim de cada execução. Ele consolida os registros mais recentes por unidade e competência e permite filtrar por competência, ano, mês, categoria e unidade. A pasta `relatorios` fica reservada somente para os relatórios HTML individuais de cada execução.
