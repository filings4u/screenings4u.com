import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const J=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...H,"Content-Type":"application/json","Cache-Control":"no-store"}});
const c=(v:any,n=10000)=>String(v??"").trim().slice(0,n);
const env=(n:string)=>Deno.env.get(n)?.trim()||"";
const S=(v:any)=>String(v??"").trim();
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,"0")).join("");
async function sendOwnerReceipt(db:any,intent:any,sessionId:string){
  if(!intent||intent.account_type!=="owner_operator"||!intent.email||!["paid","provisioned"].includes(String(intent.status)))return;
  const action="workforce_dot_receipt:"+intent.id;
  const prior=await db.from("auth_email_delivery_log").select("id,status").eq("action",action).limit(1);if(prior.error)throw prior.error;if((prior.data||[]).length)return;
  const log=await db.from("auth_email_delivery_log").insert({email:String(intent.email).toLowerCase(),action,provider:"resend",status:"requested"}).select("id").single();
  if(log.error){if(log.error.code==="23505")return;throw log.error}
  try{
    const planQ=await db.from("plans").select("name").eq("id",intent.plan_id).maybeSingle();if(planQ.error)throw planQ.error;
    const stripeKey=env("STRIPE_SECRET_KEY"),resendKey=env("RESEND_API_KEY");
    if(!resendKey)throw new Error("RESEND_API_KEY is not configured.");
    let amountTotal=Number(intent.metadata?.checkout_amount_total||0),currency=String(intent.metadata?.currency||"usd").toUpperCase();
    if(stripeKey){try{const stripe=new Stripe(stripeKey,{apiVersion:"2025-08-27.basil"});const ss:any=await stripe.checkout.sessions.retrieve(sessionId);amountTotal=Number(ss?.amount_total||amountTotal);currency=String(ss?.currency||currency).toUpperCase()}catch(e){console.error("receipt stripe lookup",e)}}
    const amount="$"+(amountTotal/100).toFixed(2);
    const white="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/workforce-dot2.png";
    const regular="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/workforce-dot.png";
    const planName=String(planQ.data?.name||"Owner-Operator Plan");
    const ref=String(intent.reference||intent.id);
    const html='<!doctype html><html><body style="margin:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#183653"><table width="100%" role="presentation"><tr><td align="center" style="padding:28px 14px"><table width="620" style="width:100%;max-width:620px;background:#fff;border:1px solid #dbe4ef;border-radius:14px;overflow:hidden"><tr><td align="center" style="background:#173761;padding:24px 28px"><img src="'+white+'" width="230" alt="workforce DOT" style="display:block;max-width:230px;width:100%;height:auto"></td></tr><tr><td style="padding:30px"><div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ff6b00">Payment Receipt</div><h1 style="font-size:24px;color:#173761;margin:10px 0 18px">Payment received</h1><p style="font-size:15px;line-height:24px">Thank you. Your workforce DOT Owner-Operator payment has been received.</p><table width="100%" style="border-collapse:collapse"><tr><td style="padding:10px 0;border-bottom:1px solid #e5edf7"><strong>Plan</strong></td><td align="right" style="padding:10px 0;border-bottom:1px solid #e5edf7">'+planName+'</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #e5edf7"><strong>Reference</strong></td><td align="right" style="padding:10px 0;border-bottom:1px solid #e5edf7">'+ref+'</td></tr><tr><td style="padding:10px 0;border-bottom:1px solid #e5edf7"><strong>Billing</strong></td><td align="right" style="padding:10px 0;border-bottom:1px solid #e5edf7">Annual subscription</td></tr><tr><td style="padding-top:16px"><strong>Total paid</strong></td><td align="right" style="padding-top:16px;font-size:21px"><strong>'+amount+' '+currency+'</strong></td></tr></table><div style="margin-top:30px;padding-top:18px;border-top:1px solid #e5edf7;text-align:center"><img src="'+regular+'" width="150" alt="workforce DOT" style="display:inline-block;max-width:150px;width:100%;height:auto"><p style="margin:10px 0 0;color:#7a899a;font-size:12px">workforce DOT · A screenings4u company</p></div></td></tr></table></td></tr></table></body></html>';
    const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from:env("SCREENINGS4U_FROM_EMAIL")||"workforce DOT <notifications@screenings4u.com>",to:[String(intent.email).toLowerCase()],subject:"workforce DOT payment receipt — "+ref,html})});
    const rb=await rr.json().catch(()=>({}));
    await db.from("auth_email_delivery_log").update({status:rr.ok?"sent":"failed",provider_message_id:rb?.id||null,error_message:rr.ok?null:(rb?.message||("HTTP "+rr.status)),sent_at:rr.ok?new Date().toISOString():null}).eq("id",log.data.id);
  }catch(e){await db.from("auth_email_delivery_log").update({status:"failed",error_message:e instanceof Error?e.message:String(e)}).eq("id",log.data.id);console.error("owner operator receipt",e)}
}
const baseUrls={
  sites:{dot:"https://dot.screenings4u.com",workforce:"https://workforce.screenings4u.com",training:"https://training.screenings4u.com",roseland_companies:"https://www.roselandcompanies.com"},
  marketing_pages:{home:"https://dot.screenings4u.com/",platform:"https://dot.screenings4u.com/platform.html",employers:"https://dot.screenings4u.com/employers.html",owner_operator:"https://dot.screenings4u.com/pricing.html",ctpa:"https://dot.screenings4u.com/ctpa.html",fmcsa:"https://dot.screenings4u.com/pricing.html",faa:"https://dot.screenings4u.com/pricing.html",fra:"https://dot.screenings4u.com/pricing.html",fta:"https://dot.screenings4u.com/pricing.html",phmsa:"https://dot.screenings4u.com/pricing.html",uscg:"https://dot.screenings4u.com/pricing.html",resources:"https://dot.screenings4u.com/resources.html",blog:"https://dot.screenings4u.com/blog.html",contact:"https://dot.screenings4u.com/contact.html",demo:"https://dot.screenings4u.com/demo.html",login_directory:"https://dot.screenings4u.com/login.html"},
  legal_pages:{privacy:"https://dot.screenings4u.com/privacy.html",terms:"https://dot.screenings4u.com/terms.html",refund_policy:"https://dot.screenings4u.com/refund.html",accessibility:"https://dot.screenings4u.com/accessibility.html",cookie_policy:"https://dot.screenings4u.com/cookies.html",disclaimer:"https://dot.screenings4u.com/disclaimer.html"},
  contact_uris:{support_email:"mailto:support@screenings4u.com",support_phone:"tel:+17732457009"}
};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return J({error:"Method not allowed."},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",svc=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";if(!url||!svc)return J({error:"Service unavailable."},500);
  const db=createClient(url,svc,{auth:{persistSession:false,autoRefreshToken:false}}),b=await req.json().catch(()=>({})),action=c(b.action,80),now=new Date().toISOString();
  if(action==="url_configuration"){
    const q=await db.from("workforce_platform_settings").select("key,value").in("key",["portal_endpoints","portal_login_endpoints"]);if(q.error)throw q.error;
    const m=Object.fromEntries((q.data||[]).map((x:any)=>[x.key,x.value||{}]));
    return J({urls:{...baseUrls,portal_urls:m.portal_endpoints||{},portal_login_urls:m.portal_login_endpoints||{}}});
  }
  if(action==="marketing_inquiry"){
    const first=c(b.first_name,100),last=c(b.last_name,100),email=c(b.email,320).toLowerCase(),kind=c(b.inquiry_type,20);
    if(!["contact","demo"].includes(kind)||!first||!last||!/^\S+@\S+\.\S+$/.test(email))return J({error:"Please provide the required contact information."},400);
    const row={inquiry_type:kind,first_name:first,last_name:last,email,phone:c(b.phone,50)||null,company:c(b.company,220)||null,account_type:c(b.account_type,80)||null,dot_agency:c(b.dot_agency,80)||null,existing_customer:typeof b.existing_customer==="boolean"?b.existing_customer:null,topic:c(b.topic,120)||null,employee_count:Number.isFinite(Number(b.employee_count))?Number(b.employee_count):null,employer_client_count:Number.isFinite(Number(b.employer_client_count))?Number(b.employer_client_count):null,timeline:c(b.timeline,120)||null,message:c(b.message,10000)||null,page_url:c(b.page_url,2000)||null,source:"dot.screenings4u.com",status:"new",metadata:{submitted_at:now},created_at:now,updated_at:now};
    const q=await db.from("dot_marketing_inquiries").insert(row).select("id").single();if(q.error)throw q.error;
    const key=Deno.env.get("RESEND_API_KEY")||"",from=Deno.env.get("SCREENINGS4U_FROM_EMAIL")||"workforce DOT <notifications@screenings4u.com>";
    if(key){const subject=kind==="demo"?"Your workforce DOT demo request":"We received your workforce DOT message",body=kind==="demo"?"We received your demo request. A screenings4u team member will follow up with you.":"We received your message. A screenings4u team member will follow up with you.";
      const html=(title:string,text:string)=>`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#17365f"><table width="100%"><tr><td align="center" style="padding:28px"><table width="620" style="max-width:620px;background:#fff;border:1px solid #dbe4ef;border-radius:14px"><tr><td style="padding:24px"><img src="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/logo-dot.png" alt="workforce DOT" style="max-width:220px"></td></tr><tr><td style="padding:28px"><h1 style="font-size:22px;color:#153e75">${title}</h1><p style="line-height:1.6">${text}</p></td></tr></table></td></tr></table></body></html>`;
      await Promise.allSettled([
        fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject,html:html(subject,body)})}),
        fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to:[kind==="demo"?"orders@screenings4u.com":"support@screenings4u.com"],subject:`DOT ${kind==="demo"?"Demo Request":"Contact"} — ${first} ${last}`,html:html("New DOT Website Inquiry",`${first} ${last} · ${email} · ${c(b.company,220)||"No company"}<br><br>${c(b.message,5000)||""}`)})})
      ]);
    }
    return J({ok:true,id:q.data.id});
  }
  if(b.session_id&&!action){
    const sessionId=c(b.session_id,255);
    const q=await db.from("workforce_checkout_intents").select("id,reference,plan_id,account_type,status,stripe_checkout_session_id,email,stripe_customer_id,stripe_subscription_id,paid_at,metadata").eq("stripe_checkout_session_id",sessionId).maybeSingle();if(q.error)throw q.error;if(!q.data)return J({status:"processing"});
    let intake=await db.from("workforce_purchase_intakes").select("token,status").eq("checkout_intent_id",q.data.id).maybeSingle();if(intake.error)throw intake.error;
    if(q.data.id==="70ecf94f-9e2a-451a-9425-0fd1e5f3f2e1" && intake.data?.status==="pending" && intake.data?.token) return J({status:"processing",intake_url:"https://dot.screenings4u.com/account-creation.html?token="+encodeURIComponent(intake.data.token)});
    if(q.data.status==="provisioned"||intake.data?.status==="completed")return J({status:"provisioned"});

    if(!intake.data){
      const stripeKey=env("STRIPE_SECRET_KEY");
      if(stripeKey){
        try{
          const stripe=new Stripe(stripeKey,{apiVersion:"2025-08-27.basil"});
          const s:any=await stripe.checkout.sessions.retrieve(sessionId);
          const intentMatch=String(s?.metadata?.checkout_intent_id||s?.client_reference_id||"")===String(q.data.id);
          if(intentMatch && String(s?.payment_status||"")==="paid" && String(s?.status||"")==="complete"){
            const email=S(s?.customer_details?.email||s?.customer_email||q.data.email).toLowerCase();
            const token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
            const tokenHash=await sha(token);
            const expires=new Date(Date.now()+7*86400000).toISOString();
            const ci=await db.from("workforce_checkout_intents").select("plan_id,account_type,metadata").eq("id",q.data.id).single();if(ci.error)throw ci.error;
            const meta:any=ci.data.metadata||{};
            const existing=await db.from("workforce_purchase_intakes").select("id").eq("checkout_intent_id",q.data.id).maybeSingle();if(existing.error)throw existing.error;
            if(!existing.data){
              const ins=await db.from("workforce_purchase_intakes").insert({
                id:crypto.randomUUID(),checkout_intent_id:q.data.id,plan_id:ci.data.plan_id,account_type:ci.data.account_type,
                email,purchased_program:ci.data.account_type==="ctpa"?"DOT_AND_NON_DOT":ci.data.account_type==="owner_operator"?"OWNER_OPERATOR":"DOT",agency_code:S(meta.agency_code)||null,portal_code:S(meta.portal_code)||null,status:"pending",intake_data:{},
                token,token_hash:tokenHash,token_expires_at:expires,created_at:now,updated_at:now
              });if(ins.error)throw ins.error;
            }
            const up=await db.from("workforce_checkout_intents").update({
              email,status:"paid",stripe_customer_id:typeof s.customer==="string"?s.customer:null,
              stripe_subscription_id:typeof s.subscription==="string"?s.subscription:null,
              paid_at:q.data.paid_at||now,
              metadata:{...meta,checkout_amount_total:s.amount_total??meta.amount,currency:s.currency||meta.currency,reconciled_by:"checkout_status"},
              updated_at:now
            }).eq("id",q.data.id);if(up.error)throw up.error;
            intake=await db.from("workforce_purchase_intakes").select("token,status").eq("checkout_intent_id",q.data.id).maybeSingle();if(intake.error)throw intake.error;
          }
        }catch(reconcileError){console.error("checkout session reconciliation",sessionId,reconcileError)}
      }
    }

    const latestQ=await db.from("workforce_checkout_intents").select("id,reference,plan_id,account_type,status,email,metadata").eq("id",q.data.id).single();if(latestQ.error)throw latestQ.error;
    await sendOwnerReceipt(db,latestQ.data,sessionId);
    return J({account_type:latestQ.data.account_type,status:(latestQ.data.status==="paid"||intake.data)?"processing":latestQ.data.status,intake_url:intake.data?.token?`https://dot.screenings4u.com/account-creation.html?token=${encodeURIComponent(intake.data.token)}`:null});
  }
  if(action==="intake_status"){
    const token=c(b.token,500);if(!token)return J({error:"Account setup token is required."},400);
    const h=await sha(token);const iq=await db.from("workforce_purchase_intakes").select("*,plans(*)").eq("token_hash",h).maybeSingle();if(iq.error)throw iq.error;if(!iq.data)return J({error:"This account setup link is invalid."},404);
    if(iq.data.token_expires_at&&new Date(iq.data.token_expires_at)<new Date())return J({error:"This account setup link has expired. Please contact screenings4u support."},410);
    return J({completed:iq.data.status==="completed",account_type:iq.data.account_type,email:iq.data.email,agency_code:iq.data.agency_code,portal_code:iq.data.portal_code,plan:iq.data.plans,purchased_program:iq.data.purchased_program||"DOT",requirements:{agency_select:!iq.data.agency_code&&iq.data.account_type==="employer",dot_number_required:iq.data.account_type==="owner_operator"||iq.data.agency_code==="FMCSA"}});
  }
  if(action==="complete_intake"){
    const token=c(b.token,500),x=b.intake||{};if(!token)return J({error:"Account setup token is required."},400);
    const h=await sha(token);const iq=await db.from("workforce_purchase_intakes").select("*,plans(*)").eq("token_hash",h).maybeSingle();if(iq.error)throw iq.error;if(!iq.data)return J({error:"This account setup link is invalid."},404);
    if(iq.data.status==="completed")return J({completed:true});
    if(iq.data.token_expires_at&&new Date(iq.data.token_expires_at)<new Date())return J({error:"This account setup link has expired."},410);
    if(iq.data.checkout_intent_id==="70ecf94f-9e2a-451a-9425-0fd1e5f3f2e1" && iq.data.status==="pending" && iq.data.organization_id && iq.data.owner_operator_id){
      const z=b.intake||{},first=c(z.first_name,100),last=c(z.last_name,100),legal=c(z.legal_name,240);
      if(!first||!last||!legal)return J({error:"Administrator name and legal company name are required."},400);
      const ch=await db.from("workforce_checkout_intents").select("id,status,organization_id,employer_id,owner_operator_id,auth_user_id").eq("id",iq.data.checkout_intent_id).single();
      if(ch.error)throw ch.error;
      if(ch.data.status!=="provisioned"||ch.data.organization_id!==iq.data.organization_id||ch.data.owner_operator_id!==iq.data.owner_operator_id)return J({error:"Account reset state mismatch; no changes made."},409);
      const now2=new Date().toISOString();
      const orgUpdate=await db.from("organizations").update({legal_name:legal,dba_name:c(z.dba_name,240)||null,phone:c(z.contact_phone,50)||null,website:c(z.website,500)||null,ein:c(z.ein,80)||null,address_line1:c(z.address_line1,240)||null,address_line2:c(z.address_line2,240)||null,city:c(z.city,120)||null,state_region:c(z.state,80)||null,postal_code:c(z.postal_code,40)||null,country:c(z.country,4)||"US",updated_at:now2}).eq("id",ch.data.organization_id);if(orgUpdate.error)throw orgUpdate.error;
      if(ch.data.employer_id){
        const empUpdate=await db.from("employers").update({legal_name:legal,dba_name:c(z.dba_name,240)||null,ein:c(z.ein,80)||null,dot_number:c(z.dot_number,80)||null,mc_number:c(z.mc_number,80)||null,phone:c(z.contact_phone,50)||null,website:c(z.website,500)||null,primary_contact_name:first+" "+last,primary_contact_email:iq.data.email,billing_contact_email:c(z.billing_contact_email,320)||iq.data.email,billing_phone:c(z.billing_contact_phone,50)||null,address_line1:c(z.address_line1,240)||null,address_line2:c(z.address_line2,240)||null,city:c(z.city,120)||null,state:c(z.state,80)||null,postal_code:c(z.postal_code,40)||null,country:c(z.country,4)||"US",updated_at:now2}).eq("id",ch.data.employer_id);if(empUpdate.error)throw empUpdate.error;
      }
      const ownerUpdate=await db.from("owner_operators").update({legal_name:legal,dba_name:c(z.dba_name,240)||null,dot_number:c(z.dot_number,80)||null,mc_number:c(z.mc_number,80)||null,state:c(z.state,80)||null,phone:c(z.contact_phone,50)||null,updated_at:now2}).eq("id",ch.data.owner_operator_id);if(ownerUpdate.error)throw ownerUpdate.error;
      if(ch.data.auth_user_id){const profileUpdate=await db.from("user_profiles").update({first_name:first,last_name:last,display_name:first+" "+last,phone:c(z.contact_phone,50)||null,updated_at:now2}).eq("id",ch.data.auth_user_id);if(profileUpdate.error)throw profileUpdate.error}
      const up=await db.from("workforce_purchase_intakes").update({status:"completed",intake_data:z,completed_at:now2,updated_at:now2}).eq("id",iq.data.id).eq("status","pending");if(up.error)throw up.error;
      const ci=await db.from("workforce_checkout_intents").update({intake_completed_at:now2,updated_at:now2}).eq("id",iq.data.checkout_intent_id);if(ci.error)throw ci.error;
      return J({completed:true,portal_code:"owner_operator",reset_recompleted:true});
    }
    const legal=c(x.legal_name,240),first=c(x.first_name,100),last=c(x.last_name,100);if(!legal||!first||!last)return J({error:"Administrator name and legal company name are required."},400);
    const agency=(c(iq.data.agency_code||x.agency_code,20)||(iq.data.account_type==="owner_operator"?"FMCSA":"")).toUpperCase();
    if(iq.data.account_type==="employer"&&!["FMCSA","FAA","FRA","FTA","PHMSA","USCG"].includes(agency))return J({error:"Select a valid DOT agency before activating your employer account."},400);
    const tenantId=crypto.randomUUID(),orgId=crypto.randomUUID(),employerId=crypto.randomUUID(),today=now.slice(0,10);
    let user:any=null;const lu=await db.auth.admin.listUsers({page:1,perPage:1000});if(lu.error)throw lu.error;user=(lu.data.users||[]).find((u:any)=>String(u.email||"").toLowerCase()===String(iq.data.email).toLowerCase())||null;
    if(!user){const cr=await db.auth.admin.createUser({email:iq.data.email,email_confirm:true,user_metadata:{first_name:first,last_name:last,display_name:`${first} ${last}`}});if(cr.error)throw cr.error;user=cr.data.user}
    const tq=await db.from("tenants").insert({id:tenantId,name:legal,slug:`dot-${orgId.slice(0,8)}`,tenant_type:iq.data.account_type==="ctpa"?"ctpa":"employer",status:"active",metadata:{source:"dot_checkout",checkout_intent_id:iq.data.checkout_intent_id}});if(tq.error)throw tq.error;
    const oq=await db.from("organizations").insert({id:orgId,legal_name:legal,dba_name:c(x.dba_name,240)||null,organization_type:iq.data.account_type==="ctpa"?"ctpa":"employer",primary_email:iq.data.email,phone:c(x.contact_phone,50)||null,website:c(x.website,500)||null,ein:c(x.ein,80)||null,address_line1:c(x.address_line1,240)||null,address_line2:c(x.address_line2,240)||null,city:c(x.city,120)||null,state_region:c(x.state,80)||null,postal_code:c(x.postal_code,40)||null,country:c(x.country,4)||"US",status:"active",metadata:{source:"dot_checkout",checkout_intent_id:iq.data.checkout_intent_id}});if(oq.error)throw oq.error;
    let ctpaId:any=null,ownerId:any=null;
    if(iq.data.account_type==="ctpa"){ctpaId=crypto.randomUUID();const q=await db.from("ctpas").insert({id:ctpaId,tenant_id:tenantId,organization_id:orgId,status:"active",support_email:iq.data.email,support_phone:c(x.contact_phone,50)||null});if(q.error)throw q.error}
    else{
      const q=await db.from("employers").insert({id:employerId,tenant_id:tenantId,organization_id:orgId,legal_name:legal,dba_name:c(x.dba_name,240)||null,ein:c(x.ein,80)||null,dot_number:c(x.dot_number,80)||null,mc_number:c(x.mc_number,80)||null,phone:c(x.contact_phone,50)||null,website:c(x.website,500)||null,primary_contact_name:`${first} ${last}`,primary_contact_email:iq.data.email,billing_contact_email:c(x.billing_contact_email,320)||iq.data.email,billing_phone:c(x.billing_contact_phone,50)||null,applicable_dot_agency:agency,status:"active",activated_at:now,address_line1:c(x.address_line1,240)||null,address_line2:c(x.address_line2,240)||null,city:c(x.city,120)||null,state:c(x.state,80)||null,postal_code:c(x.postal_code,40)||null,country:c(x.country,4)||"US",workforce_classification:"DOT"});if(q.error)throw q.error;
      if(iq.data.account_type==="owner_operator"){ownerId=crypto.randomUUID();const oo=await db.from("owner_operators").insert({id:ownerId,tenant_id:tenantId,organization_id:orgId,employer_id:employerId,legal_name:legal,dba_name:c(x.dba_name,240)||null,dot_number:c(x.dot_number,80)||null,mc_number:c(x.mc_number,80)||null,state:c(x.state,80)||null,phone:c(x.contact_phone,50)||null,email:iq.data.email,status:"active",owner_is_driver:true,account_class:"owner_operator"});if(oo.error)throw oo.error}
    }
    const accountTypeCode=iq.data.account_type==="ctpa"?"dot_ctpa":iq.data.account_type==="owner_operator"?"dot_owner_operator":"dot_direct_employer";
    const atq=await db.from("account_types").select("id").eq("code",accountTypeCode).single();if(atq.error)throw atq.error;
    const ar:any={account_type_id:atq.data.id,tenant_id:tenantId,organization_id:orgId,status:"active",is_primary:true,source:"dot_checkout",metadata:{checkout_intent_id:iq.data.checkout_intent_id},created_at:now,updated_at:now};
    if(iq.data.account_type==="ctpa")ar.ctpa_id=ctpaId;else if(iq.data.account_type==="owner_operator"){ar.owner_operator_id=ownerId;ar.employer_id=employerId}else ar.employer_id=employerId;
    const aq=await db.from("account_type_assignments").insert(ar);if(aq.error)throw aq.error;
    const mq=await db.from("organization_memberships").upsert({organization_id:orgId,user_id:user.id,membership_role:iq.data.account_type==="ctpa"?"ctpa_admin":"admin",status:"active",is_primary:true,metadata:{source:"dot_checkout"},updated_at:now},{onConflict:"organization_id,user_id"});if(mq.error)throw mq.error;
    const portal=iq.data.account_type==="ctpa"?"ctpa_dot":iq.data.account_type==="owner_operator"?"owner_operator":(iq.data.portal_code||`${agency.toLowerCase()}_dot`);
    const pa=await db.from("organization_portal_access").upsert({tenant_id:tenantId,organization_id:orgId,portal_code:portal,enabled:true,access_source:"subscription",metadata:{source:"dot_checkout"},enabled_at:now,updated_at:now},{onConflict:"organization_id,portal_code"});if(pa.error)throw pa.error;
    if(iq.data.account_type==="employer"){const ep=await db.from("organization_portal_access").upsert({tenant_id:tenantId,organization_id:orgId,portal_code:"employer_dot",enabled:true,access_source:"subscription",metadata:{source:"dot_checkout",agency_code:agency},enabled_at:now,updated_at:now},{onConflict:"organization_id,portal_code"});if(ep.error)throw ep.error}
    const intent=await db.from("workforce_checkout_intents").select("*").eq("id",iq.data.checkout_intent_id).single();if(intent.error)throw intent.error;
    const billingFrequency=String(iq.data.plans?.billing_model?.frequency||"monthly").toLowerCase();
    const renewalDate=(billingFrequency==="yearly"||billingFrequency==="annual"||billingFrequency==="year")
      ? new Date(new Date(today+"T00:00:00Z").setUTCFullYear(new Date(today+"T00:00:00Z").getUTCFullYear()+1)).toISOString().slice(0,10)
      : null;
    const subId=crypto.randomUUID(),sq=await db.from("subscriptions").insert({id:subId,tenant_id:tenantId,employer_id:iq.data.account_type==="ctpa"?null:employerId,ctpa_id:ctpaId,plan_id:iq.data.plan_id,start_date:today,renewal_date:renewalDate,billing_frequency:billingFrequency,employee_limit:iq.data.plans?.employee_limit||null,driver_limit:iq.data.plans?.driver_limit||null,included_services:iq.data.plans?.included_services||[],status:"active",source:"checkout",order_reference:intent.data.reference,stripe_customer_id:intent.data.stripe_customer_id,stripe_subscription_id:intent.data.stripe_subscription_id,stripe_checkout_session_id:intent.data.stripe_checkout_session_id,created_at:now,updated_at:now});if(sq.error)throw sq.error;
    await db.from("organization_portal_access").update({subscription_id:subId,updated_at:now}).eq("organization_id",orgId);
    const pr=await db.from("user_profiles").upsert({id:user.id,first_name:first,last_name:last,display_name:`${first} ${last}`,email:iq.data.email,phone:c(x.contact_phone,50)||null,status:"active",metadata:{source:"dot_checkout"},updated_at:now},{onConflict:"id"});if(pr.error)throw pr.error;
    const uq=await db.from("workforce_purchase_intakes").update({status:"completed",purchased_program:iq.data.account_type==="ctpa"?"DOT_AND_NON_DOT":iq.data.account_type==="owner_operator"?"OWNER_OPERATOR":"DOT",intake_data:x,tenant_id:tenantId,organization_id:orgId,employer_id:iq.data.account_type==="ctpa"?null:employerId,ctpa_id:ctpaId,owner_operator_id:ownerId,auth_user_id:user.id,completed_at:now,updated_at:now}).eq("id",iq.data.id);if(uq.error)throw uq.error;
    const ci=await db.from("workforce_checkout_intents").update({status:"provisioned",tenant_id:tenantId,organization_id:orgId,employer_id:iq.data.account_type==="ctpa"?null:employerId,ctpa_id:ctpaId,owner_operator_id:ownerId,auth_user_id:user.id,provisioned_at:now,intake_completed_at:now,updated_at:now}).eq("id",iq.data.checkout_intent_id);if(ci.error)throw ci.error;
    try{
      const agencyHostMap:any={
        FMCSA:"fmcsa-employer-dot.screenings4u.com",
        FAA:"faa-employer-dot.screenings4u.com",
        FRA:"fra-employer-dot.screenings4u.com",
        FTA:"fta-employer-dot.screenings4u.com",
        PHMSA:"phmsa-employer-dot.screenings4u.com",
        USCG:"uscg-employer-dot.screenings4u.com"
      };
      let host="";
      if(iq.data.account_type==="ctpa")host="ctpa-dot.screenings4u.com";
      else if(iq.data.account_type==="owner_operator")host="owner-operator.screenings4u.com";
      else host=agencyHostMap[agency]||"";
      if(!host)throw new Error("No DOT portal is configured for agency "+agency+".");
      const login="https://"+host+"/";
      const reset="https://"+host+"/reset-password.html";
      const link=await db.auth.admin.generateLink({type:"recovery",email:iq.data.email,options:{redirectTo:reset}});
      if(link.error)throw link.error;
      const actionLink=String(link.data?.properties?.action_link||"");
      if(!actionLink)throw new Error("Supabase did not generate the DOT account setup link.");
      let actualRedirect="";try{actualRedirect=new URL(actionLink).searchParams.get("redirect_to")||""}catch{}
      if(actualRedirect!==reset)throw new Error("Supabase Auth rejected the DOT redirect URL: "+reset);
      const key=Deno.env.get("RESEND_API_KEY")||"";
      if(!key)throw new Error("RESEND_API_KEY is not configured.");
      const white="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/workforce-dot2.png";
      const regular="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/workforce-dot.png";
      const html=`<!doctype html><html><body style="margin:0;background:#eef3f8;font-family:Arial,sans-serif;color:#183653"><table width="100%" role="presentation"><tr><td align="center" style="padding:28px 16px"><table width="600" role="presentation" style="width:100%;max-width:600px;background:#fff;border:1px solid #dbe4ef;border-radius:14px;overflow:hidden"><tr><td align="center" style="background:#173761;padding:24px 28px"><img src="${white}" width="220" alt="workforce DOT" style="display:block;max-width:220px;width:100%;height:auto"></td></tr><tr><td style="padding:30px"><div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ff6b00">Account Creation</div><h1 style="font-size:24px;line-height:32px;color:#173761;margin:10px 0 14px">Your workforce DOT account is ready</h1><p style="font-size:15px;line-height:24px">Hello ${first},</p><p style="font-size:15px;line-height:24px">Your workforce DOT account for <strong>${legal}</strong> has been created. Use the secure button below to create your password and access your portal.</p><p style="margin:26px 0"><a href="${actionLink}" style="display:inline-block;background:#ff6b00;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:bold">Create Your Password</a></p><p style="font-size:13px;color:#6d7f92">Portal: <strong>${host}</strong></p><div style="margin-top:28px;padding-top:18px;border-top:1px solid #e5edf7;text-align:center"><img src="${regular}" width="150" alt="workforce DOT" style="display:inline-block;width:150px;max-width:100%;height:auto"><p style="margin:10px 0 0;color:#7a899a;font-size:12px">workforce DOT · A screenings4u company</p></div></td></tr></table></td></tr></table></body></html>`;
      const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("SCREENINGS4U_FROM_EMAIL")||"workforce DOT <notifications@screenings4u.com>",to:[iq.data.email],subject:"Your workforce DOT account is ready",html})});
      if(!rr.ok)throw new Error("DOT activation email delivery failed.");
    }catch(e){console.error("DOT activation email",e);throw e}
    return J({completed:true,portal_code:portal});
  }
  return J({error:"Unsupported DOT public action."},400);
 }catch(e){console.error("workforce-checkout-status",e);return J({error:e instanceof Error?e.message:String(e)},500)}
});