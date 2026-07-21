(function(){
  "use strict";

  const config = window.SM_FLEX_SUPABASE;
  const client = window.supabase.createClient(config.url, config.publishableKey);
  window.smFlexDb = client;
  let currentSession = null;
  let currentProfile = null;

  const byId = id => document.getElementById(id);
  const todayIso = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0,10);
  };
  const pctField = id => {
    const raw = String(byId(id)?.value || "").replace(/[^\d,.-]/g, "").replace(",", ".");
    const value = Number(raw);
    return Number.isFinite(value) ? value / 100 : null;
  };
  const integerText = id => {
    const match = String(byId(id)?.textContent || "").match(/\d+/);
    return match ? Number(match[0]) : null;
  };
  const status = (message, kind="") => {
    const el = byId("saveStatus");
    if(!el) return;
    el.textContent = message;
    el.className = `save-status ${kind}`.trim();
  };

  async function loadProfile(user){
    const {data, error} = await client.from("profiles")
      .select("id,full_name,email,role,active")
      .eq("id", user.id)
      .single();
    if(error) throw error;
    if(!data.active){
      await client.auth.signOut();
      throw new Error("Usuário desativado. Procure o administrador.");
    }
    currentProfile = data;
    const userBox = byId("topbarUser");
    if(userBox){
      const role = data.role === "super_admin" ? "Administrador geral" : data.role === "manager" ? "Gestor" : "Operador";
      userBox.innerHTML = `<strong>${escapeHtml(data.full_name)}</strong>${role}`;
    }
    byId("authGate").hidden = true;
  }

  function escapeHtml(value){
    return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  }

  function showLogin(message=""){
    currentSession = null;
    currentProfile = null;
    byId("authGate").hidden = false;
    byId("loginError").textContent = message;
  }

  function inviteFlowDetected(){
    const params = new URLSearchParams(location.search);
    return location.hash.includes("type=invite") || params.get("type") === "invite";
  }

  function showSetPassword(){
    const card = byId("loginForm");
    card.innerHTML = `
      <img src="logo_sm_flex.png" alt="San Marino Flex">
      <h1>Crie sua senha</h1>
      <p>Defina uma senha pessoal com pelo menos oito caracteres.</p>
      <div class="field"><label>Nova senha</label><input id="newPassword" type="password" minlength="8" autocomplete="new-password" required></div>
      <div class="field"><label>Confirmar senha</label><input id="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></div>
      <button class="auth-btn" type="submit">Salvar senha</button>
      <p class="auth-error" id="loginError"></p>`;
    card.onsubmit = async event => {
      event.preventDefault();
      const password = byId("newPassword").value;
      if(password !== byId("confirmPassword").value){
        byId("loginError").textContent = "As senhas não conferem.";
        return;
      }
      const {error} = await client.auth.updateUser({password});
      if(error){
        byId("loginError").textContent = error.message;
        return;
      }
      history.replaceState({}, document.title, location.pathname);
      await loadProfile(currentSession.user);
    };
  }

  async function initializeAuth(){
    byId("simulationDate").value = todayIso();
    const {data:{session}} = await client.auth.getSession();
    currentSession = session;
    if(session){
      if(inviteFlowDetected()) showSetPassword();
      else await loadProfile(session.user);
    }else showLogin();

    client.auth.onAuthStateChange(async (_event, sessionValue) => {
      currentSession = sessionValue;
      if(sessionValue && !inviteFlowDetected()){
        try{ await loadProfile(sessionValue.user); }
        catch(error){ showLogin(error.message); }
      }else if(!sessionValue) showLogin();
    });
  }

  byId("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const email = byId("loginEmail").value.trim().toLowerCase();
    const password = byId("loginPassword").value;
    byId("loginError").textContent = "Entrando...";
    const {data, error} = await client.auth.signInWithPassword({email,password});
    if(error){
      byId("loginError").textContent = "E-mail ou senha inválidos.";
      return;
    }
    currentSession = data.session;
    try{ await loadProfile(data.user); }
    catch(profileError){ showLogin(profileError.message); }
  });

  byId("logoutBtn").addEventListener("click", async () => {
    await client.auth.signOut();
    showLogin();
  });

  const openHistory = () => { location.href = "admin.html"; };
  byId("historyBtn").addEventListener("click", openHistory);
  byId("openHistoryBtn").addEventListener("click", openHistory);

  byId("clientPhone").addEventListener("input", event => {
    const digits = event.target.value.replace(/\D/g, "").slice(0,11);
    if(digits.length <= 2) event.target.value = digits;
    else if(digits.length <= 6) event.target.value = `(${digits.slice(0,2)}) ${digits.slice(2)}`;
    else if(digits.length <= 10) event.target.value = `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
    else event.target.value = `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  });

  byId("saveSimulationBtn").addEventListener("click", async () => {
    if(!currentSession || !currentProfile){ showLogin("Entre novamente para salvar."); return; }
    const clientName = byId("clientName").value.trim();
    const clientPhone = byId("clientPhone").value.trim();
    const model = byId("modelo").value.trim();
    const price = numVal("preco");
    const entry = numVal("eVal");
    const informedInstallment = numVal("parc");
    if(!clientName || !clientPhone){ status("Informe nome e telefone do cliente.","error"); return; }
    if(!model || !price || !entry || !informedInstallment){ status("Complete os dados da simulação antes de salvar.","error"); return; }

    const signalText = byId("sVal").value;
    const eligible = signalText.includes("R$") && byId("flexParcelasValor").textContent.includes("R$");
    const payload = {
      created_by: currentSession.user.id,
      simulation_date: byId("simulationDate").value || todayIso(),
      client_name: clientName,
      client_phone: clientPhone,
      notes: byId("clientNotes").value.trim(),
      vehicle_model: model,
      vehicle_year: byId("anoModelo").value,
      vehicle_price: price,
      entry_value: entry,
      entry_percent: price ? entry / price : 0,
      financing_term: Number(byId("flexLine").value),
      informed_installment: informedInstallment,
      flex_months: Number(byId("mesesFlex").value),
      cash_signal_percent: pctField("sPctAuto"),
      cash_signal_value: eligible ? parseMoney(signalText) : null,
      deferred_entry_percent: pctField("cPctAuto"),
      deferred_entry_value: eligible ? parseMoney(byId("cVal").value) : null,
      flex_installment_value: eligible ? parseMoney(byId("flexParcelasValor").textContent) : null,
      financing_installments: integerText("finParcelasQtd"),
      financing_installment_value: eligible ? parseMoney(byId("finParcelasValor").textContent) : null,
      eligible,
      result_status: eligible ? "Elegível" : (signalText || "Não elegível"),
      calculation_snapshot: {
        entry_percent_display: byId("ePct").value,
        cash_signal_display: signalText,
        flex_installments_display: byId("flexParcelasQtd").textContent,
        flex_value_display: byId("flexParcelasValor").textContent,
        financing_installments_display: byId("finParcelasQtd").textContent,
        financing_value_display: byId("finParcelasValor").textContent
      }
    };

    status("Salvando...");
    const {error} = await client.from("simulations").insert(payload);
    if(error){ status(`Não foi possível salvar: ${error.message}`,"error"); return; }
    status("Simulação salva com sucesso.","ok");
  });

  initializeAuth().catch(error => showLogin(`Falha ao iniciar: ${error.message}`));
})();
