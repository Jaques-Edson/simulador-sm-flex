import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPER_ADMIN_EMAIL = "edson@sanmarinofiat.com.br";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  async fetch(request: Request) {
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
    const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) throw new Error("Sessão inválida.");

    const requesterEmail = String(claimsData.claims.email || "").trim().toLowerCase();
    const { data: requesterProfile, error: requesterProfileError } = await admin.from("profiles")
      .select("role,active")
      .eq("id", claimsData.claims.sub)
      .single();
    if (requesterProfileError || requesterEmail !== SUPER_ADMIN_EMAIL || requesterProfile?.role !== "super_admin" || !requesterProfile?.active) {
      return Response.json({ error: "Somente o administrador geral ativo pode gerenciar senhas." }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const action = String(body.action || "");

    if (action === "reset_password") {
      const userId = String(body.user_id || "").trim();
      const password = String(body.password || "");
      if (!/^[0-9a-f-]{36}$/i.test(userId) || password.length < 8) throw new Error("Usuário e senha de oito caracteres são obrigatórios.");
      if (userId === claimsData.claims.sub) throw new Error("Use a opção Alterar minha senha para sua própria conta.");

      const { data: targetProfile, error: targetError } = await admin.from("profiles")
        .select("id,email")
        .eq("id", userId)
        .single();
      if (targetError || !targetProfile) throw new Error("Usuário não encontrado.");

      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
      if (updateError) throw updateError;
      return Response.json({ id: userId, email: targetProfile.email }, { headers: corsHeaders });
    }

    if (action !== "create") throw new Error("Ação não permitida.");
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
    console.error("manage-user error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Erro inesperado." }, { status: 400, headers: corsHeaders });
  }
  },
};
