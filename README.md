# 📝 Demandas

App simples e rápido para **anotar demandas** (tipo bloco de notas), com **categorias**, **nível de prioridade** (opcional) e **uso em conjunto** — todo mundo vê a mesma lista atualizando **ao vivo**. Dá pra **falar** que a **IA estrutura** a demanda pra você.

- **Front-end estático** (HTML/CSS/JS puro) → roda de graça no **GitHub Pages**.
- **Supabase** → banco de dados + **Realtime** (colaboração em tempo real).
- **Voz** → reconhecimento de fala nativo do navegador (Web Speech API).
- **IA** → uma **Edge Function** do Supabase estrutura a fala em título/categoria/prioridade, mantendo a **chave da IA no servidor** (nunca exposta no site).

---

## ✨ Como funciona no dia a dia

1. Abre o site, digita a demanda e aperta **Enter** — pronto, anotada.
2. Ou toca no **🎤** e fala: *"pagar o boleto da internet, é urgente"* → a IA cria a demanda com título limpo, categoria **Financeiro** e prioridade **Alta**.
3. Marca categoria e prioridade (prioridade é **opcional**).
4. Todo mundo do time que abrir o mesmo **quadro** vê tudo em tempo real.

---

## 🚀 Setup (uma vez, ~15 min)

### 1) Criar o projeto no Supabase (grátis)

1. Crie uma conta em <https://supabase.com> e clique **New project**.
2. Anote a senha do banco (não precisa pro app, mas guarde).
3. Quando o projeto subir, vá em **Project Settings → API** e copie:
   - **Project URL** (ex: `https://abcd.supabase.co`)
   - **anon public** key

### 2) Criar a tabela

No painel do Supabase: **SQL Editor → New query** → cole todo o conteúdo de
[`supabase/schema.sql`](supabase/schema.sql) → **Run**.

Isso cria a tabela `demands`, liga o **Realtime** e as permissões.

### 3) Configurar o front-end

```bash
cp config.example.js config.js
```

Abra `config.js` e preencha:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcd.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...sua-anon-key...",
  BOARD: "geral", // nome do quadro compartilhado do time
};
```

> `config.js` está no `.gitignore` de propósito. Se quiser publicar no GitHub Pages, veja a nota de deploy abaixo — a anon key **pode** ficar pública (é feita pra isso), mas você precisa decidir se o quadro fica aberto ou protegido (seção **Segurança**).

### 4) Testar localmente

```bash
# qualquer servidor estático serve. Ex com Python:
python3 -m http.server 8000
# abra http://localhost:8000
```

Já deve funcionar: anotar, categorizar, marcar prioridade e colaboração em tempo real. O **🎤 voz** funciona melhor no **Chrome**.

### 5) (Opcional, mas recomendado) Ligar a IA de verdade

A voz vira texto sozinha no navegador. Para a **IA estruturar** a fala (título limpo + categoria + prioridade), suba a Edge Function:

```bash
# instale a CLI do Supabase: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref SEU_PROJECT_REF   # o ref aparece na URL do painel

# guarde a chave da IA como SECRET (fica no servidor, nunca no site)
supabase secrets set OPENAI_API_KEY=sk-xxxxxxxx

# publique a função
supabase functions deploy parse-demand
```

Pronto — quando você falar, o app chama essa função e recebe a demanda estruturada.
Sem a função configurada, o app usa um **parser local** simples (detecta "urgente", categorias por palavra-chave etc.), então **nunca deixa de funcionar**.

> Quer usar **Claude** em vez da OpenAI? Está tudo comentado no fim de
> [`supabase/functions/parse-demand/index.ts`](supabase/functions/parse-demand/index.ts) — troque o bloco `fetch` e use `supabase secrets set ANTHROPIC_API_KEY=...`.

---

## 🌐 Publicar no GitHub Pages

1. Suba o projeto num repositório:
   ```bash
   git init
   git add .
   git commit -m "App de demandas"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/demandas.git
   git push -u origin main
   ```
2. No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, escolha **main / (root)** e salve.
3. Em ~1 min o site fica no ar em `https://SEU_USUARIO.github.io/demandas/`.

> **Importante:** o `.gitignore` ignora `config.js`. Para o site publicado funcionar, você precisa **ou** commitar um `config.js` (a anon key pode ser pública), **ou** editar o `config.example.js`. A forma mais simples: remova `config.js` do `.gitignore` e commite-o — **desde que** você tenha lido a seção de Segurança abaixo.

---

## 🔒 Segurança — leia antes de deixar público

Este app foi feito **sem login** pra ser prático entre pessoas de confiança. Com a configuração padrão, **qualquer pessoa com o link + a anon key** (que fica no site) pode ler e gravar demandas no seu quadro.

Para uso interno de um time pequeno, isso costuma ser suficiente. Se o site for **público na internet** e você quiser proteger, escolha um caminho:

- **Mais simples:** mantenha o repositório **privado** e compartilhe o site só com o time (ex: hospede num lugar com senha em vez de Pages público).
- **Login de verdade:** ative **Supabase Auth** (e-mail/Google) e troque a política do `schema.sql` para exigir usuário autenticado (`to authenticated`). Assim só pessoas logadas acessam.
- **Quadros "secretos":** use um `BOARD` com nome difícil de adivinhar (ex: `time-a-9fk2z1`). Não é segurança forte, mas evita curiosos.

---

## 🗂️ Estrutura

```
demandas/
├── index.html          # a página
├── styles.css          # visual (tema claro/escuro)
├── app.js              # lógica: dados, realtime, voz, IA, filtros
├── config.example.js   # modelo de configuração (copie p/ config.js)
├── supabase/
│   ├── schema.sql      # banco + realtime + permissões
│   └── functions/
│       └── parse-demand/index.ts   # IA (chave fica no servidor)
├── .gitignore
└── README.md
```

## 🧩 Funcionalidades

- Captura rápida (Enter) e por **voz** 🎤
- **Categorias** (padrão + crie as suas)
- **Prioridade opcional**: baixa / média / alta (com cores)
- **Colaboração em tempo real** entre quem usa o mesmo quadro
- Filtros por status, categoria e busca
- Concluir, editar e apagar
- Tema claro/escuro
- Exportar tudo em **JSON**
- Funciona **offline-friendly**: salva de forma otimista e sincroniza

## 🛠️ Solução de problemas

- **"Falta configurar"** na tela → você não criou o `config.js` (passo 3).
- **Não carrega / erro no console** → confira URL/anon key e se rodou o `schema.sql`.
- **Voz não funciona** → use o **Chrome** e permita o microfone. Alguns navegadores não têm a Web Speech API.
- **IA não estrutura** → normal se você não subiu a Edge Function; o parser local assume. Para IA real, faça o passo 5.
