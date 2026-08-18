// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÃO — copie este arquivo para "config.js" e preencha.
//
//   cp config.example.js config.js
//
// Estes dois valores são PÚBLICOS (podem ficar no site/GitHub).
// A "anon key" do Supabase é feita para o navegador — a segurança
// vem das políticas de acesso (RLS) do banco, não de esconder a key.
//
// A chave da IA (OpenAI/Claude) NÃO fica aqui — ela mora como
// "secret" na Edge Function do Supabase, no servidor. Veja o README.
// ─────────────────────────────────────────────────────────────

window.APP_CONFIG = {
  // URL do seu projeto Supabase, ex: https://abcdefgh.supabase.co
  SUPABASE_URL: "COLE_AQUI_A_URL_DO_SUPABASE",

  // Chave pública "anon" do projeto (Settings → API → anon public)
  SUPABASE_ANON_KEY: "COLE_AQUI_A_ANON_KEY",

  // Nome do "quadro"/time compartilhado. Todos que usarem o mesmo
  // valor veem a mesma lista de demandas. Ex: "financeiro", "time-a".
  BOARD: "geral",
};
