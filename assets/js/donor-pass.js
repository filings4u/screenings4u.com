/** screenings4u — Labcorp Donor Pass */
"use strict";
document.addEventListener("DOMContentLoaded", initDonorPass);

async function initDonorPass(){
  const params=new URLSearchParams(location.search);
  const orderId=String(params.get("order")||params.get("order_id")||"").trim();
  const tracking=String(params.get("tracking")||params.get("tracking_number")||"").trim();
  document.getElementById("printButton")?.addEventListener("click",()=>{const ready=Array.from(document.querySelectorAll(".dp-item")).some(el=>el.dataset.issued==="true");if(ready)window.print();else showMessage("Your donor pass is not ready for printing until registration is confirmed.","error")});
  setupLabcorpSitePicker(orderId,tracking);
  if(!orderId||!tracking){showMessage("This donor-pass link is incomplete. Use the link from your order confirmation or receipt email.","error");renderEmpty();return}
  try{
    const base=String(window.SCREENINGS4U_SUPABASE_URL||"").replace(/\/+$/,"");
    if(!base)throw new Error("The donor-pass service is not configured.");
    const r=await fetch(base+"/functions/v1/public-testing-donor-pass",{method:"POST",headers:{"Content-Type":"application/json","apikey":window.SCREENINGS4U_SUPABASE_ANON_KEY||""},body:JSON.stringify({order_id:orderId,tracking})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Unable to load your donor pass.");
    renderOrder(d.order||{},d.donor_passes||[],d.cases||[]);
    history.replaceState({},"",location.pathname+"?"+new URLSearchParams({order:orderId,tracking}).toString());
  }catch(e){console.error("donor pass",e);showMessage(e.message||"Unable to load your donor pass.","error");renderEmpty()}
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function fmt(v){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}).format(d)}
function label(v){return String(v||"pending").replaceAll("_"," ")}
function renderOrder(order,passes,cases){
  setText("trackingNumber",order.tracking_number||"—");setText("orderNumber",order.order_number||"—");
  const host=document.getElementById("donorPassList");if(!host)return;
  if(!passes.length){host.innerHTML=`<div class="status active"><div class="status-title">Donor pass is being prepared.</div><div class="status-copy">Your payment is confirmed. The Testing workflow is active, and your donor pass will appear here as soon as the registration record is ready.</div></div>`;showMessage("Your order is paid and active. No donor pass has been issued yet.","success");return}
  host.innerHTML=passes.map((p,i)=>{const l=p.labcorp||{};const registered=Boolean(l.registration_number);const site=p.collection_site_name||"Pending collection location";const address=p.collection_site_address||"Collection-site address will appear when assigned.";const note=registered?(p.status==="issued"?"Bring a government-issued photo ID and this donor pass to the assigned collection site.":"Your testing registration exists. screenings4u is finalizing your donor-pass/site details."):"Your paid order created a testing registration draft. The registration number will appear here once registration is complete.";return `<article class="dp-item" data-issued="${p.status==="issued"&&registered}"><div class="dp-head"><div><h2>${esc(p.test_type||p.panel_name||`Drug Test ${i+1}`)}</h2><p>${esc(p.pass_number||"Donor pass pending")}</p></div><span class="dp-badge">${esc(label(p.status))}</span></div><div class="dp-grid"><div class="dp-cell"><span>Donor</span><strong>${esc(p.donor_name||order.customer_name||"—")}</strong></div><div class="dp-cell"><span>Specimen</span><strong>${esc(p.specimen_type||"—")}</strong></div><div class="dp-cell"><span>Reason</span><strong>${esc(p.test_reason||"—")}</strong></div><div class="dp-cell"><span>Registration Number</span><strong>${esc(l.registration_number||"Pending")}</strong></div><div class="dp-cell"><span>Registration Status</span><strong>${esc(l.status_text||label(l.status)||"Pending")}</strong></div><div class="dp-cell"><span>Collection Deadline</span><strong>${esc(fmt(p.collection_deadline))}</strong></div></div><div class="dp-site"><h3>${esc(site)}</h3><p>${esc(address)}</p></div><div class="dp-note">${esc(note)}</div></article>`}).join("");
  showMessage("Your donor-pass workflow is linked to your paid screenings4u order and testing registration.","success");
}
function renderEmpty(){const host=document.getElementById("donorPassList");if(host)host.innerHTML='<div class="status active"><div class="status-title">Donor pass unavailable.</div><div class="status-copy">Please verify the link or contact screenings4u for assistance.</div></div>'}
function showMessage(message,type){const el=document.getElementById("pageMessage");if(!el)return;el.className="notice "+type;el.textContent=message;el.style.display="block"}
function setText(id,v){const el=document.getElementById(id);if(el)el.textContent=v}

function setupLabcorpSitePicker(orderId,tracking){
 const form=document.getElementById("labcorpSiteSearch"),host=document.getElementById("labcorpSiteResults");
 if(!form||!host)return;
 if(!orderId||!tracking){document.getElementById("labcorpLocationPicker").hidden=true;return}
 const base=String(window.SCREENINGS4U_SUPABASE_URL||"https://elpbnytpciqnbexiaebp.supabase.co").replace(/\/$/,"");
 async function call(body){
  const r=await fetch(base+"/functions/v1/public-labcorp-sites",{method:"POST",headers:{"Content-Type":"application/json","apikey":window.SCREENINGS4U_SUPABASE_ANON_KEY||""},body:JSON.stringify({order_id:orderId,tracking,...body})});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"Location request failed");return data;
 }
 form.addEventListener("submit",async ev=>{
  ev.preventDefault();const zip=document.getElementById("labcorpSiteZip").value.trim();if(!/^\d{5}$/.test(zip))return;
  host.replaceChildren();host.textContent="Searching collection locations…";
  try{
   const data=await call({action:"search",zip,distance:25});host.replaceChildren();
   if(!data.sites?.length){host.textContent="No locations returned for this ZIP. Try another ZIP code.";return}
   for(const site of data.sites){
    const panel=document.createElement("div");panel.style.cssText="padding:14px 0;border-bottom:1px solid #d7e3f4";
    const name=document.createElement("strong");name.textContent=site.name;
    const address=document.createElement("p");address.textContent=site.address+(site.distance?" · "+site.distance+" miles":"");
    const button=document.createElement("button");button.type="button";button.className="btn btn-blue";button.textContent="Choose this location";
    button.addEventListener("click",()=>confirmSelectedSite(site, async()=>{
      const result=await call({action:"select",site_id:site.id});
      if(!result.saved)throw Error("Could not save collection location.");
      const dialog=passDialog(),target=dialog.querySelector("#passWorkflowContent");
      target.replaceChildren();
      const title=document.createElement("h2");title.textContent="Location confirmed";
      const message=document.createElement("p");message.setAttribute("role","status");
      message.textContent="Your location is saved. Checking registration status…";
      const generate=document.createElement("button");generate.type="button";generate.className="btn btn-orange";generate.textContent="Generate Donor Pass";generate.disabled=true;
      target.append(title,message,generate);
      let checks=0;
      const refresh=async()=>{
        if(!dialog.open)return;
        try{
          const state=await loadPassState(orderId,tracking);
          renderOrder(state.order||{},state.donor_passes||[],state.cases||[]);
          const ready=(state.donor_passes||[]).some(p=>p.status==="issued"&&p.labcorp?.registration_number);
          if(ready){
            message.textContent="Registration confirmed. Your donor pass is ready.";
            generate.disabled=false;
            generate.onclick=()=>showPassViewer(state,site);
            return;
          }
          message.textContent="Registration is processing. Your pass will be available after confirmation.";
        }catch(error){message.textContent="Unable to check registration right now. Please try again shortly.";}
        if(++checks<12)setTimeout(refresh,5000);
        else message.textContent="Registration is not complete yet. Close this window and return to this page to check again.";
      };
      await refresh();
    }));
    panel.append(name,address,button);host.appendChild(panel)
   }
  }catch(error){host.textContent=error.message||"Location search is unavailable"}
 });
}

async function loadPassState(orderId,tracking){
 const base=String(window.SCREENINGS4U_SUPABASE_URL||"").replace(/\/+$/,"");
 const r=await fetch(base+"/functions/v1/public-testing-donor-pass",{
  method:"POST",headers:{"Content-Type":"application/json","apikey":window.SCREENINGS4U_SUPABASE_ANON_KEY||""},
  body:JSON.stringify({order_id:orderId,tracking}),cache:"no-store"
 });
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||"Unable to load your pass");
 return data;
}
function passDialog(){
 let node=document.getElementById("passWorkflowDialog");
 if(node)return node;
 node=document.createElement("dialog");node.id="passWorkflowDialog";node.className="s4u-pass-dialog";
 node.innerHTML='<div class="pass-modal-body"><button type="button" class="pass-modal-close" aria-label="Close">×</button><div id="passWorkflowContent"></div></div>';
 document.body.appendChild(node);
 node.querySelector(".pass-modal-close").addEventListener("click",()=>node.close());
 node.addEventListener("click",e=>{if(e.target===node)node.close()});
 return node;
}
function confirmSelectedSite(site,onConfirm){
 const dialog=passDialog();
 const target=dialog.querySelector("#passWorkflowContent");
 target.replaceChildren();
 const title=document.createElement("h2");title.textContent="Confirm your collection location";
 const locationName=document.createElement("h3");locationName.textContent=site.name||"Collection location";
 const address=document.createElement("p");address.textContent=site.address||"";
 const msg=document.createElement("p");msg.textContent="Please confirm this is the location you wish to use for your test.";
 const error=document.createElement("p");error.className="pass-modal-error";error.setAttribute("role","alert");
 const actions=document.createElement("div");actions.className="pass-modal-buttons";
 const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Change location";cancel.onclick=()=>dialog.close();
 const confirm=document.createElement("button");confirm.type="button";confirm.className="btn btn-orange";confirm.textContent="Confirm location";
 confirm.onclick=async()=>{
   confirm.disabled=true;confirm.textContent="Saving location…";error.textContent="";
   try{await onConfirm()}catch(e){error.textContent=e.message||"Unable to save location";confirm.disabled=false;confirm.textContent="Confirm location";}
 };
 actions.append(cancel,confirm);target.append(title,locationName,address,msg,error,actions);dialog.showModal();
}
function showPassViewer(data,site){
 const dialog=passDialog(),target=dialog.querySelector("#passWorkflowContent");
 target.replaceChildren();
 const passes=data.donor_passes||[];
 const issued=passes.filter(p=>p.status==="issued"&&p.labcorp?.registration_number);
 const title=document.createElement("h2");title.textContent=issued.length?"Your donor pass is ready":"Collection location confirmed";
 const desc=document.createElement("p");desc.textContent=issued.length?
 "Your pass is ready. Use Print / Save as PDF to keep a copy.":
 "Your location is saved. Your donor pass is being prepared and will become available when registration is confirmed.";
 const name=document.createElement("h3");name.textContent=site.name||"Collection location";
 const address=document.createElement("p");address.textContent=site.address||"";
 target.append(title,desc,name,address);
 for(const pass of passes){
  const card=document.createElement("section");card.className="pass-modal-card";
  const heading=document.createElement("h3");heading.textContent=pass.test_type||"Testing service";
  const donor=document.createElement("p");donor.textContent="Donor: "+(pass.donor_name||"—");
  const registration=document.createElement("p");registration.textContent="Registration: "+(pass.labcorp?.registration_number||"Pending");
  const status=document.createElement("p");status.textContent="Status: "+(pass.status==="issued"?"Issued":"Preparing");
  card.append(heading,donor,registration,status);target.append(card);
 }
 const actions=document.createElement("div");actions.className="pass-modal-buttons";
 const done=document.createElement("button");done.type="button";done.textContent="Close";done.onclick=()=>dialog.close();actions.append(done);
 if(issued.length){
  const pdf=document.createElement("button");pdf.type="button";pdf.className="btn btn-orange";pdf.textContent="Download / Save PDF";pdf.onclick=()=>window.print();actions.append(pdf);
 }
 target.append(actions);
}
