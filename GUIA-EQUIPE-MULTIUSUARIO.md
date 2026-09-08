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
2. exige que o painel tenha sido gerado por uma execução;
3. copia somente `painel/painel-dashboard.html` para `painel/index.html`;
4. prepara somente os arquivos públicos do painel para commit;
5. pede confirmação;
6. faz commit e push;
7. deixa o workflow do GitHub Pages publicar o site.

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
