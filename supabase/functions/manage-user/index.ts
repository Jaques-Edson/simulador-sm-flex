import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Sessão ausente.");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Sessão inválida.");

    const { data: requester } = await admin.from("profiles")
      .select("role,active")
      .eq("id", userData.user.id)
      .single();
    if (!requester?.active || requester.role !== "super_admin") {
      return Response.json({ error: "Somente o administrador geral pode criar usuários." }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    if (body.action !== "create") throw new Error("Ação não permitida.");
    const fullName = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = body.role === "manager" ? "manager" : "operator";
    if (!fullName || !email || password.length < 8) throw new Error("Nome, e-mail e senha de oito caracteres são obrigatórios.");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError) throw createError;

    const { error: profileError } = await admin.from("profiles")
      .update({ full_name: fullName, role, active: true })
      .eq("id", created.user.id);
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw profileError;
    }
    return Response.json({ id: created.user.id, email, role }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro inesperado." }, { status: 400, headers: corsHeaders });
  }
});
