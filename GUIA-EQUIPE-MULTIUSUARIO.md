# Macroindicadores SUBHUE — uso por 3 pessoas da equipe

## Arquitetura adotada

Cada profissional usa:

- seu próprio usuário do Windows (na Prefeitura, normalmente o CPF);
- seu próprio CPF/senha do SMS Rio, protegidos pelo Windows naquele perfil;
- a conta Google da equipe `subhueindicadores@gmail.com` para Sheets e Drive;
- sua própria autenticação GitHub para acessar o repositório privado.

Nenhuma senha do SMS Rio é enviada ao GitHub. `segredos/`, `perfil-navegador/` e logs técnicos permanecem fora do repositório.

## O que o atalho permite

O atalho **Macroindicadores SUBHUE** abre um menu com:

1. executar/conferir/atualizar os Macroindicadores;
2. publicar o painel atualizado no GitHub;
3. abrir o painel local;
4. abrir o último relatório HTML;
5. abrir os backups locais;
6. abrir a pasta de backups no Google Drive;
7. configurar o login individual do SMS Rio;
8. autorizar a conta Google da equipe;
9. atualizar o robô pelo GitHub;
10. verificar ambiente e acessos.

A geração do relatório e os backups continuam fazendo parte da execução normal do robô. Não são processos paralelos independentes.

## Primeira instalação de cada colega

### Pré-requisitos

- Git for Windows;
- Node.js 20 ou superior;
- conta GitHub adicionada como colaboradora do repositório privado;
- acesso à conta/pastas Google da equipe;
- `credentials.json` OAuth fornecido por canal seguro.

### Instalação recomendada

Use o instalador da equipe (`INSTALAR-MACROINDICADORES-EQUIPE.bat`). Ele clona o repositório em:

`%USERPROFILE%\Documents\Macroindicadores SUBHUE`

Depois instala dependências e cria o atalho da Área de Trabalho.

Na primeira autenticação do GitHub, o Git Credential Manager poderá abrir o navegador. Cada profissional deve autenticar sua própria conta GitHub autorizada no repositório.

### Configuração individual

1. Abra o atalho **Macroindicadores SUBHUE**.
2. Escolha **Configurar meu login do SMS Rio**.
3. Se o usuário do Windows for um CPF de 11 dígitos, ele será sugerido automaticamente.
4. Digite a senha do próprio usuário.
5. Escolha **Autorizar a conta Google da equipe** e entre em `subhueindicadores@gmail.com`.
6. Execute **Verificar ambiente e acessos**.


## Estado compartilhado do painel

O painel não depende mais somente dos logs existentes em um computador. O robô usa a conta Google da equipe para manter um estado comum no Google Drive.

A pasta é criada automaticamente dentro da pasta principal do projeto no Drive:

`Estado compartilhado do painel`

com duas áreas:

- `Logs de execucao`: cada execução é armazenada separadamente, com usuário Windows, data/hora, competência e modo;
- `Snapshots por unidade`: as fotografias do Google Sheets são versionadas por unidade.

Os arquivos compartilhados são **append-only/versionados** para reduzir conflito entre computadores. Se duas pessoas executarem o robô em horários próximos, cada execução mantém seu próprio log e sua própria versão da fotografia da unidade. Na sincronização, o painel usa a versão mais recente de cada unidade.

Na primeira execução depois desta atualização, o computador que já possui o histórico pode demorar um pouco mais, pois migra os logs antigos e divide o snapshot consolidado existente em fotografias por unidade. Nos usos seguintes, o cache local evita baixar novamente arquivos que não mudaram.

### Fluxo de cada execução

1. sincroniza o histórico da equipe no Google Drive;
2. consulta o SMS Rio;
3. lê o Google Sheets;
4. nos modos 2/3, confirma o backup no Drive antes de gravar;
5. salva o log da execução;
6. envia o log e as fotografias das unidades consultadas para o estado compartilhado;
7. sincroniza novamente;
8. gera o painel consolidado.

A opção **Abrir o painel local** também tenta sincronizar o estado compartilhado antes de abrir. A opção **Publicar o painel** sincroniza e regenera o painel antes do commit; se a sincronização falhar, a publicação é bloqueada para evitar uma fotografia parcial.

## Google da equipe

O projeto exige a conta:

`subhueindicadores@gmail.com`

Se outro e-mail for autorizado por engano, a execução é bloqueada e orienta a refazer `autorizar-google.bat`.

## Backup local

O caminho não fica mais preso ao computador do Rodolfo. O padrão é calculado para cada perfil:

`%USERPROFILE%\Documents\Backup do macro indicadores`

## Publicação do painel

A opção **Publicar o painel atualizado no GitHub**:

1. verifica se o computador está atualizado com `origin/main`;
2. sincroniza logs e snapshots compartilhados no Google Drive e regenera o painel consolidado;
3. se a sincronização falhar, bloqueia a publicação para evitar painel parcial;
4. copia somente `painel/painel-dashboard.html` para `painel/index.html`;
5. prepara somente os arquivos públicos do painel para commit;
6. pede confirmação;
7. faz commit e push;
8. deixa o workflow do GitHub Pages publicar o site.

Se outro colega tiver publicado uma versão mais nova, a publicação é bloqueada e a pessoa precisa atualizar o robô e executar novamente a conferência. Isso reduz risco de uma publicação antiga sobrescrever uma nova.

## Atualização do robô

A opção **Atualizar o robô pelo GitHub** usa `git pull --ff-only` e atualiza as dependências npm. Se houver alterações locais não resolvidas, a atualização é cancelada para evitar perda de arquivos.

## Identidade Git

Recomendação: cada pessoa use seu próprio nome/e-mail no Git, mesmo que o Google seja compartilhado. Assim o histórico do GitHub identifica quem publicou cada versão.

Exemplo (uma única vez no computador da pessoa):

```bat
git config --global user.name "Nome da Pessoa"
git config --global user.email "email-da-pessoa@dominio"
```

Não é necessário usar o CPF no commit.

## Segurança

Não compartilhar:

- `segredos/token.json`;
- `segredos/smsrio-senha.dat`;
- `perfil-navegador/`;
- tokens do GitHub.

O arquivo `smsrio-senha.dat` só pode ser descriptografado pelo mesmo usuário do Windows no mesmo contexto em que foi criado.
