# Meu Vade Mecum — correção de importação (v2)

## Diagnóstico do problema no endereço meuvade.netlify.app

A interface em HTML/CSS/JS pode funcionar mesmo quando a função que consulta o Planalto **não foi publicada**. O comando de busca da legislação depende da Function `legislation` no servidor do Netlify. Se apenas os arquivos estáticos forem enviados, a busca falha. Também podem existir problemas de rede, limites/erros de execução ou diferenças de formatação no HTML do Planalto.

Esta versão melhora os erros mostrados ao usuário e adiciona **importação manual de um HTML** baixado diretamente do site oficial, que funciona mesmo sem a Function. A importação manual **não é atualização automática**, nem atesta a vigência do arquivo. A atualização automática precisa do serviço do Netlify funcionando.

### Como resolver definitivamente, mantendo o endereço meuvade.netlify.app

**Método recomendado: conectar o site existente a um repositório GitHub.**

1. Faça um backup de suas anotações, se tiver alguma: na lateral do aplicativo, escolha **Exportar backup**. Não limpe os dados do navegador.
2. Descompacte `meu_vade_mecum_correcao_netlify.zip` no computador. Mantenha toda a estrutura do projeto, inclusive a pasta `netlify/functions`, o arquivo `package.json` e `netlify.toml`.
3. No GitHub, crie um repositório novo (pode ser privado), sem README inicial, e envie **os arquivos da pasta descompactada, não só o ZIP**. Confirme que `index.html` está na raiz do repositório e que existe `netlify/functions/legislation.mjs`.
4. Entre no painel do Netlify e abra o projeto existente **meuvade** (evite criar um segundo site). Procure **Project configuration → Developer settings → Continuous deployment → Repository → Link repository**. Conecte o repositório criado.
5. Na configuração do projeto, use: **Build command: em branco**, **Publish directory: `.`**, **Functions directory: `netlify/functions`**. A pasta das funções já está indicada no `netlify.toml`.
6. Aguarde o Netlify concluir o deploy iniciado pelo repositório. Em **Deploys / Deploy log**, confirme que a função `legislation` foi reconhecida e que a dependência `cheerio` foi instalada durante o build.
7. Teste, em nova aba: `https://meuvade.netlify.app/.netlify/functions/legislation?health=1`. O resultado esperado é um pequeno JSON com `"ok":true`. Se retornar 404, a função não está publicada. Se retornar 502/500, acesse os logs do Netlify para ver o erro real.
8. Em `https://meuvade.netlify.app`, use **Adicionar legislação → Verificar serviço de importação**. O diagnóstico tentará importar como teste a Lei 6.019/1974 e exibirá o resultado. Se a função está ativa, mas a consulta oficial falhar, verifique os logs da função `legislation`.

Links oficiais do serviço: https://docs.netlify.com/build/functions/get-started/ e https://docs.netlify.com/build/git-workflows/repo-permissions-linking/.

### Sem GitHub (por terminal)

Se já usa Node.js/Netlify CLI, abra um terminal na pasta do projeto e execute:

```bash
npm install
npx netlify login
npx netlify link
npx netlify deploy --build --prod
```

O `netlify link` deve apontar ao projeto existente **meuvade**. Netlify CLI envia tanto a interface quanto as funções. Evite `netlify init` sem antes vincular o site, pois você pode acabar criando outro projeto.

### Alternativa imediata: importar a página HTML salva

1. Abra a lei no site oficial do Planalto, por exemplo: https://www.planalto.gov.br/ccivil_03/leis/l6019.htm
2. No computador, use **Salvar página como → Página web, somente HTML** e guarde um arquivo `.htm` ou `.html`. Arquivos `.mhtml` e PDFs não são aceitos por esta funcionalidade.
3. No aplicativo atualizado, acesse **Adicionar legislação**; informe o tipo, o número e o ano e, se souber, a URL oficial.
4. Em **Alternativa: importar HTML salvo**, selecione o arquivo. O aplicativo tentará identificar os artigos e salvá-los neste navegador.
5. Confira as redações no site oficial. A importação de cópia local não prova que o documento esteja compilado ou vigente. A atualização automática só funcionará quando o servidor estiver configurado.

### Testes e limitações

- Teste executado com exemplo em HTML contendo três artigos e seus parágrafos/incisos: extração identificou três artigos, preservou o texto vigente do exemplo e ignorou um artigo riscado. **Isso não equivale a testar a consulta externa do Planalto no Netlify.**
- Fontes de importação automática nesta versão: Planalto. A consulta ao Senado ainda não foi implementada.
- A atualização é verificada ao usar o aplicativo; não existe verificação permanente quando ele está fechado.
- O extrator pode interpretar incorretamente dispositivos, disposições revogadas ou trechos em tabelas/HTML incomum. Sempre consulte o texto oficial e verifique mudanças importantes.
- As anotações, marcações, imagens, áudios e leis ficam no IndexedDB local do navegador, sem sincronização entre aparelhos. **Faça backups antes de trocar de navegador ou limpar dados.**

### Estrutura dos arquivos

- `index.html`, `app.js`, `app.css`, `db.js`, `local-parser.js`: interface, armazenamento e importação de HTML salvo.
- `netlify/functions/legislation.mjs`: busca oficial no servidor, executada somente após um deploy com Netlify Functions.
- `package.json`: dependências para empacotar a Function.
- `netlify.toml`: configurações do Netlify, rotas e Functions.
- `manifest.webmanifest`, `service-worker.js`, `icons/`: instalação como aplicativo (PWA).

Não há chave de API necessária neste MVP.
