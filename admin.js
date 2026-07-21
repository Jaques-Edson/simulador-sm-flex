(function(){
  "use strict";
  const cfg = window.SM_FLEX_SUPABASE;
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey);
  const $ = id => document.getElementById(id);
  let profile = null;
  let rows = [];
  let filtered = [];

  const money = value => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value)||0);
  const percent = value => `${(Number(value||0)*100).toLocaleString("pt-BR",{maximumFractionDigits:1})}%`;
  const dateBr = value => value ? value.split("-").reverse().join("/") : "--";
  const safe = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const isManager = () => ["manager","super_admin"].includes(profile?.role);

  async function requireSession(){
    const {data:{session}} = await client.auth.getSession();
    if(!session){ location.href="index.html"; return null; }
    const {data,error}=await client.from("profiles").select("id,full_name,email,role,active").eq("id",session.user.id).single();
    if(error || !data?.active){ await client.auth.signOut(); location.href="index.html"; return null; }
    profile=data;
    const label=data.role==="super_admin"?"Administrador geral":data.role==="manager"?"Gestor":"Operador";
    $("panelUser").innerHTML=`<strong>${safe(data.full_name)}</strong>${label}`;
    $("accessDescription").textContent=isManager()?"Acesso a todas as simulações da equipe.":"Acesso somente às suas simulações.";
    if(data.role==="super_admin") $("usersSection").classList.add("visible");
    return session;
  }

  async function loadRows(){
    $("resultsBody").innerHTML='<tr><td class="empty" colspan="13">Carregando...</td></tr>';
    const {data,error}=await client.from("simulations")
      .select("*,profiles!simulations_created_by_fkey(full_name,email)")
      .order("simulation_date",{ascending:false})
      .order("created_at",{ascending:false})
      .limit(2000);
    if(error){ $("resultsBody").innerHTML=`<tr><td class="empty" colspan="13">${safe(error.message)}</td></tr>`; return; }
    rows=data||[];
    applyFilters();
  }

  function applyFilters(){
    const query=$("searchInput").value.trim().toLocaleLowerCase("pt-BR");
    const from=$("dateFrom").value,to=$("dateTo").value,term=$("termFilter").value,eligible=$("eligibleFilter").value;
    filtered=rows.filter(row=>{
      const haystack=[row.client_name,row.client_phone,row.notes,row.vehicle_model,row.profiles?.full_name,row.profiles?.email].join(" ").toLocaleLowerCase("pt-BR");
      return (!query||haystack.includes(query))&&(!from||row.simulation_date>=from)&&(!to||row.simulation_date<=to)&&(!term||String(row.financing_term)===term)&&(!eligible||String(row.eligible)===eligible);
    });
    renderRows();
  }

  function renderRows(){
    const body=$("resultsBody");
    if(!filtered.length){body.innerHTML='<tr><td class="empty" colspan="13">Nenhuma simulação encontrada.</td></tr>';}
    else body.innerHTML=filtered.map(row=>`<tr>
      <td>${dateBr(row.simulation_date)}</td><td>${safe(row.profiles?.full_name||row.profiles?.email||"")}</td>
      <td>${safe(row.client_name)}</td><td>${safe(row.client_phone)}</td><td>${safe(row.vehicle_model)} ${safe(row.vehicle_year)}</td>
      <td>${money(row.vehicle_price)}</td><td>${money(row.entry_value)}</td><td>${percent(row.entry_percent)}</td>
      <td>${row.financing_term}x</td><td>${money(row.informed_installment)}</td><td><span class="pill ${row.eligible?"ok":"no"}">${safe(row.result_status)}</span></td>
      <td class="notes">${safe(row.notes)}</td><td>${isManager()?`<div class="row-actions"><button class="btn secondary" data-edit="${row.id}">Editar</button><button class="btn danger" data-delete="${row.id}">Excluir</button></div>`:"--"}</td>
    </tr>`).join("");
    $("totalCount").textContent=filtered.length.toLocaleString("pt-BR");
    $("eligibleCount").textContent=filtered.filter(r=>r.eligible).length.toLocaleString("pt-BR");
    $("entryTotal").textContent=money(filtered.reduce((sum,r)=>sum+Number(r.entry_value||0),0));
    $("averagePrice").textContent=money(filtered.length?filtered.reduce((sum,r)=>sum+Number(r.vehicle_price||0),0)/filtered.length:0);
  }

  $("resultsBody").addEventListener("click",async event=>{
    const editId=event.target.dataset.edit,deleteId=event.target.dataset.delete;
    if(editId){
      const row=rows.find(item=>item.id===editId); if(!row)return;
      $("editId").value=row.id;$("editDate").value=row.simulation_date;$("editName").value=row.client_name;$("editPhone").value=row.client_phone;$("editNotes").value=row.notes||"";$("editDialog").showModal();
    }
    if(deleteId&&confirm("Excluir esta simulação permanentemente?")){
      const {error}=await client.from("simulations").delete().eq("id",deleteId);
      if(error) alert(error.message); else await loadRows();
    }
  });

  $("editForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const {error}=await client.from("simulations").update({simulation_date:$("editDate").value,client_name:$("editName").value.trim(),client_phone:$("editPhone").value.trim(),notes:$("editNotes").value.trim()}).eq("id",$("editId").value);
    if(error){alert(error.message);return;}$("editDialog").close();await loadRows();
  });
  $("cancelEdit").addEventListener("click",()=>$("editDialog").close());

  ["searchInput","dateFrom","dateTo","termFilter","eligibleFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",applyFilters));
  $("backBtn").addEventListener("click",()=>location.href="index.html");
  $("logoutPanelBtn").addEventListener("click",async()=>{await client.auth.signOut();location.href="index.html";});

  $("exportBtn").addEventListener("click",()=>{
    const data=filtered.map(row=>({
      "Data":new Date(`${row.simulation_date}T12:00:00`),"Usuário":row.profiles?.full_name||row.profiles?.email||"","E-mail do usuário":row.profiles?.email||"",
      "Cliente":row.client_name,"Telefone":row.client_phone,"Observações":row.notes||"","Veículo":row.vehicle_model,"Ano/Modelo":row.vehicle_year,
      "Preço do veículo":Number(row.vehicle_price),"Valor da entrada":Number(row.entry_value),"Percentual da entrada":Number(row.entry_percent),"Prazo":Number(row.financing_term),
      "Parcela informada":Number(row.informed_installment),"Meses Flex":Number(row.flex_months),"Sinal à vista":row.cash_signal_value==null?null:Number(row.cash_signal_value),
      "Entrada a prazo":row.deferred_entry_value==null?null:Number(row.deferred_entry_value),"Parcela Flex":row.flex_installment_value==null?null:Number(row.flex_installment_value),
      "Parcelas financiamento":row.financing_installments,"Parcela financiamento":row.financing_installment_value==null?null:Number(row.financing_installment_value),"Resultado":row.result_status
    }));
    const ws=XLSX.utils.json_to_sheet(data,{cellDates:true});
    ws["!autofilter"]={ref:ws["!ref"]||"A1:T1"};
    ws["!cols"]=[{wch:12},{wch:22},{wch:28},{wch:24},{wch:18},{wch:34},{wch:28},{wch:28},{wch:16},{wch:16},{wch:14},{wch:10},{wch:18},{wch:12},{wch:16},{wch:16},{wch:16},{wch:20},{wch:20},{wch:18}];
    for(let r=2;r<=data.length+1;r++){
      if(ws[`A${r}`])ws[`A${r}`].z="dd/mm/yyyy";
      ["I","J","M","O","P","Q","S"].forEach(col=>{if(ws[`${col}${r}`])ws[`${col}${r}`].z='R$ #,##0.00';});
      if(ws[`K${r}`])ws[`K${r}`].z="0.0%";
    }
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Simulações");XLSX.writeFile(wb,`simulacoes-san-marino-${new Date().toISOString().slice(0,10)}.xlsx`,{compression:true});
  });

  async function loadUsers(){
    if(profile?.role!=="super_admin")return;
    const {data,error}=await client.from("profiles").select("id,full_name,email,role,active").order("full_name");
    if(error){$("userMessage").textContent=error.message;return;}
    $("userList").innerHTML=(data||[]).map(user=>`<div class="user-item"><strong>${safe(user.full_name)}</strong><span>${safe(user.email)}</span><select data-role-user="${user.id}" ${user.id===profile.id?"disabled":""}><option value="operator" ${user.role==="operator"?"selected":""}>Operador</option><option value="manager" ${user.role==="manager"?"selected":""}>Gestor</option></select><button class="btn ${user.active?"danger":"primary"}" data-toggle-user="${user.id}" data-active="${user.active}" ${user.id===profile.id?"disabled":""}>${user.active?"Desativar":"Ativar"}</button></div>`).join("");
  }

  $("createUserForm").addEventListener("submit",async event=>{
    event.preventDefault();const message=$("userMessage");message.className="message";message.textContent="Criando usuário...";
    const payload={full_name:$("newUserName").value.trim(),email:$("newUserEmail").value.trim().toLowerCase(),role:$("newUserRole").value,password:$("newUserPassword").value};
    const {data,error}=await client.functions.invoke("manage-user",{body:{action:"create",...payload}});
    if(error||data?.error){message.className="message error";message.textContent=data?.error||error.message;return;}
    message.className="message success";message.textContent="Usuário criado. Entregue a senha temporária de forma privada.";event.target.reset();await loadUsers();
  });

  $("userList").addEventListener("change",async event=>{
    const userId=event.target.dataset.roleUser;if(!userId)return;
    const {error}=await client.from("profiles").update({role:event.target.value}).eq("id",userId);if(error)alert(error.message);else await loadUsers();
  });
  $("userList").addEventListener("click",async event=>{
    const userId=event.target.dataset.toggleUser;if(!userId)return;
    const next=event.target.dataset.active!=="true";const {error}=await client.from("profiles").update({active:next}).eq("id",userId);if(error)alert(error.message);else await loadUsers();
  });

  (async()=>{if(!await requireSession())return;await Promise.all([loadRows(),loadUsers()]);})().catch(error=>{$("resultsBody").innerHTML=`<tr><td class="empty" colspan="13">${safe(error.message)}</td></tr>`;});
})();
