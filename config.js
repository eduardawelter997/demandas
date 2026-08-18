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
  SUPABASE_URL: "https://jcxznqdzletaayrliyiu.supabase.co/rest/v1/",

  // Chave pública "anon" do projeto (Settings → API → anon public)
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjeHpucWR6bGV0YWF5cmxpeWl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjgwMjMsImV4cCI6MjEwMjY0NDAyM30.exI_BVtt1yDYcqVQAvtqvUylc4z7-3YY4zdezfZWiSQ",

  // Nome do "quadro"/time compartilhado. Todos que usarem o mesmo
  // valor veem a mesma lista de demandas. Ex: "financeiro", "time-a".
  BOARD: "geral",
};
