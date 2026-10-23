import Stripe from "npm:stripe@18.5.0";

import { createClient } from "npm:@supabase/supabase-js@2";

const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});

Deno.serve(async(req)=>{

 if(req.method!=="POST")return json({error:"Method not allowed."},405);

 const stripeKey=Deno.env.get("STRIPE_SECRET_KEY")||"";

 const webhookSecret=Deno.env.get("STRIPE_SECRET_WH")||"";

 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";

 const url=Deno.env.get("SUPABASE_URL")||"";

 if(!stripeKey||!webhookSecret||!service||!url){

   console.error("stripe-webhook missing required secret/environment");

   return json({error:"Webhook configuration is incomplete."},500);

 }

 const stripe=new Stripe(stripeKey,{apiVersion:"2025-08-27.basil"});

 const signature=req.headers.get("stripe-signature")||"";

 const raw=await req.text();

 let event:any;

 try{event=await stripe.webhooks.constructEventAsync(raw,signature,webhookSecret)}

 catch(e){console.error("stripe signature verification failed",e);return json({error:"Invalid signature."},400)}

 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});

 const now=new Date().toISOString();

 const updateOrder=async(pi:any,success:boolean)=>{

   const id=String(pi?.metadata?.order_id||"");

   let q=db.from("orders").update({

     payment_status:success?"paid":"failed",

     status:success?"processing":"pending",

     payment_provider:"stripe",

     payment_reference:pi?.id||null,

     stripe_payment_intent_id:pi?.id||null,

     ...(success?{paid_at:now}:{}),

     updated_at:now

   });

   q=id?q.eq("id",id):q.eq("stripe_payment_intent_id",pi?.id||"__none__");

   const r=await q;if(r.error)throw r.error;

   if(success){

     const orderId=String(pi?.metadata?.order_id||"");

     if(orderId){await provisionLabAccountIntake(orderId);await grantTestingEmployerTraining(orderId);await grantDirectTraining(orderId);await fulfillTestingOrder(orderId);await fulfillTrainingOrder(orderId)}

   }

   const inv=await db.from("invoices").update({

     status:success?"paid":"open",

     stripe_payment_intent_id:pi?.id||null,

     ...(success?{amount_paid:(Number(pi?.amount_received||pi?.amount||0)/100),amount_due:0,paid_at:now}:{}),

     updated_at:now

   }).eq("stripe_payment_intent_id",pi?.id||"__none__");

   if(inv.error)throw inv.error;

   if(success){

     const invoiceId=String(pi?.metadata?.invoice_id||"");

     if(invoiceId){

       const iq=await db.from("invoices").select("*").eq("id",invoiceId).maybeSingle();

       if(iq.error)throw iq.error;

       if(iq.data){

         const key=Deno.env.get("RESEND_API_KEY")||"";

         if(key&&iq.data.customer_email){

           const issuer=String(iq.data.issuer_legal_name||"screenings4u, LLC"),amount=(Number(pi?.amount_received||pi?.amount||0)/100).toLocaleString("en-US",{style:"currency",currency:String(iq.data.currency||"USD")});

           const logo=String(iq.data.issuer_logo_path||"");

           const html=`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#17365f"><table width="100%" role="presentation"><tr><td align="center" style="padding:28px 14px"><table width="640" role="presentation" style="max-width:640px;background:#fff;border:1px solid #dbe4ef;border-radius:14px;overflow:hidden"><tr><td style="padding:24px 28px;border-bottom:4px solid #f05a00">${logo?`<img src="${logo}" alt="${issuer}" style="display:block;max-width:260px;max-height:74px">`:`<strong style="font-size:20px;color:#244f8d">${issuer}</strong>`}</td></tr><tr><td style="padding:28px"><div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#f05a00">Payment Receipt</div><h1 style="margin:8px 0 12px;font-size:24px;color:#153e75">Payment received</h1><p style="font-size:16px;line-height:1.6">Thank you. We received <strong>${amount}</strong> for invoice <strong>${iq.data.invoice_number}</strong>.</p><p style="font-size:13px;line-height:1.6;color:#6b7c93">Stripe payment reference: ${pi.id}</p><p style="margin-top:28px;padding-top:18px;border-top:1px solid #e7edf5;font-size:12px;color:#6b7c93">Receipt issued by ${issuer}.</p></td></tr></table></td></tr></table></body></html>`;

           try{await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("SCREENINGS4U_FROM_EMAIL")||"screenings4u <notifications@screenings4u.com>",to:[iq.data.customer_email],subject:`Payment receipt — ${iq.data.invoice_number}`,html})})}catch(e){console.error("invoice receipt email",e)}

         }

       }

     }

   }

   // No public payments table exists in the consolidated schema. Invoice/order state is authoritative here.

 };

 const provisionLabAccountIntake=async(orderId:string)=>{

   if(!orderId)return null;

   const oq=await db.from("orders").select("*").eq("id",orderId).maybeSingle();if(oq.error)throw oq.error;const order:any=oq.data;if(!order||String(order.payment_status)!=="paid")return null;

   const iq=await db.from("order_items").select("metadata,services(sku,slug,name)").eq("order_id",orderId);if(iq.error)throw iq.error;

   const hasLab=(iq.data||[]).some((it:any)=>{const s:any=it.services||{};const sku=String(it.metadata?.service_sku||it.metadata?.sku||s.sku||s.slug||"").trim().toLowerCase();return sku==="lab-account"||sku==="lab_account"||String(s.name||it.metadata?.service_name||it.metadata?.name||"").trim().toLowerCase()==="lab account"});

   if(!hasLab)return null;

   let ex=await db.from("lab_account_intakes").select("*").eq("order_id",orderId).maybeSingle();if(ex.error)throw ex.error;

   let intake:any=ex.data;

   if(!intake){

     const token=crypto.randomUUID(),now2=new Date().toISOString();

     const ins=await db.from("lab_account_intakes").insert({id:crypto.randomUUID(),token,order_id:order.id,order_number:order.order_number,customer_user_id:order.user_id||null,customer_email:String(order.customer_email||"").trim().toLowerCase(),service_sku:"lab-account",workforce_dot_plan_code:order.metadata?.plan_code||null,status:"pending",intake_data:{},created_at:now2,updated_at:now2}).select("*").single();if(ins.error)throw ins.error;intake=ins.data;

   }

   const intakeUrl="https://screenings4u.com/lab-account-intake.html?token="+encodeURIComponent(intake.token);

   const meta={...(order.metadata||{}),lab_account_intake_id:intake.id,lab_account_intake_token:intake.token,lab_account_intake_url:intakeUrl,purpose:order.metadata?.purpose||"lab_account"};

   const up=await db.from("orders").update({metadata:meta,updated_at:new Date().toISOString()}).eq("id",orderId);if(up.error)throw up.error;

   return {...intake,intake_url:intakeUrl};

 };

 const grantTestingEmployerTraining=async(orderId:string)=>{ 

   if(!orderId)return;

   const oq=await db.from("orders").select("id,employer_id").eq("id",orderId).maybeSingle();

   if(oq.error)throw oq.error;

   if(!oq.data?.employer_id)return;

   let te=await db.from("testing_employers").select("id").eq("id",oq.data.employer_id).maybeSingle();

   if(te.error)throw te.error;

   if(!te.data){te=await db.from("testing_employers").select("id").eq("organization_id",oq.data.employer_id).maybeSingle();if(te.error)throw te.error}

   if(!te.data)return;

   const iq=await db.from("order_items").select("*,services(*)").eq("order_id",orderId);

   if(iq.error)throw iq.error;

   for(const item of iq.data||[]){

     const service:any=item.services||{};

     const qty=Math.max(1,Number(item.quantity||1));

     if(service?.metadata?.training_credit_package===true){

       const creditQty=Math.max(0,Number(service.metadata?.credit_quantity||0))*qty;

       if(creditQty<=0)continue;

       const existing=await db.from("testing_employer_training_credit_transactions").select("id").eq("order_item_id",item.id).eq("transaction_type","purchase").maybeSingle();

       if(existing.error)throw existing.error;

       if(existing.data)continue;

       let acct=await db.from("testing_employer_training_credit_accounts").select("*").eq("employer_id",te.data.id).maybeSingle();

       if(acct.error)throw acct.error;

       if(!acct.data){

         const a=await db.from("testing_employer_training_credit_accounts").insert({employer_id:te.data.id,balance:0,lifetime_purchased:0,lifetime_used:0}).select("*").single();

         if(a.error)throw a.error; acct=a;

       }

       const balance=Number(acct.data.balance||0),after=balance+creditQty;

       const aq=await db.from("testing_employer_training_credit_accounts").update({balance:after,lifetime_purchased:Number(acct.data.lifetime_purchased||0)+creditQty,updated_at:now}).eq("employer_id",te.data.id).eq("balance",balance).select("*").maybeSingle();

       if(aq.error)throw aq.error;

       if(!aq.data)throw new Error("Training credit account changed during payment processing.");

       const tx=await db.from("testing_employer_training_credit_transactions").insert({id:crypto.randomUUID(),employer_id:te.data.id,amount:creditQty,balance_after:after,transaction_type:"purchase",package_id:service.metadata?.training_credit_package_id||null,order_item_id:item.id,created_at:now,metadata:{order_id:orderId,service_id:service.id}});

       if(tx.error && String(tx.error.code)!=="23505")throw tx.error;

     }else if(service?.training_course_id){

       const q=await db.from("testing_employer_training_course_access").insert({id:crypto.randomUUID(),employer_id:te.data.id,course_id:service.training_course_id,service_id:service.id,source_type:"direct_purchase",order_item_id:item.id,quantity_purchased:qty,quantity_used:0,status:"active",metadata:{order_id:orderId},created_at:now,updated_at:now});

       if(q.error && String(q.error.code)!=="23505")throw q.error;

     }

   }

 };

 const grantDirectTraining=async(orderId:string)=>{

   if(!orderId)return;

   const oq=await db.from("orders").select("id,user_id,employer_id").eq("id",orderId).maybeSingle();

   if(oq.error)throw oq.error;if(!oq.data?.user_id)return;

   const iq=await db.from("order_items").select("*,services(*),lms_training_products(*)").eq("order_id",orderId);

   if(iq.error)throw iq.error;

   for(const item of iq.data||[]){

     const product:any=item.lms_training_products||null,service:any=item.services||null;

     if(product && String(product.product_kind||"")!=="course") continue;

     const courseId=product?.course_id||service?.training_course_id||null;

     if(!courseId)continue;

     const existing=await db.from("lms_enrollments").select("id").eq("user_id",oq.data.user_id).eq("course_id",courseId).maybeSingle();

     if(existing.error)throw existing.error;

     const days=Number(product?.access_days||service?.metadata?.access_days||0);

     const row:any={user_id:oq.data.user_id,course_id:courseId,status:"active",progress_percent:0,enrolled_at:now,last_activity_at:now,employer_id:oq.data.employer_id||null,assignment_source:"customer_purchase",expires_at:days>0?new Date(Date.now()+days*86400000).toISOString():null,metadata:{source:"paid_order",order_id:orderId,order_item_id:item.id},updated_at:now};

     const q=existing.data?await db.from("lms_enrollments").update(row).eq("id",existing.data.id):await db.from("lms_enrollments").insert({id:crypto.randomUUID(),...row,created_at:now});

     if(q.error)throw q.error;

   }

 };



 const testingLogo="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/logo-screenings4u.png";

 const testingPortal="https://customers.screenings4u.com";

 const testingMail=async(args:any)=>{

   const email=String(args.email||"").trim().toLowerCase();if(!email)return;

   const subject=String(args.subject||"screenings4u Testing Update");

   const html=`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#17365f"><table width="100%" role="presentation"><tr><td align="center" style="padding:28px 14px"><table width="620" role="presentation" style="max-width:620px;background:#fff;border:1px solid #dbe4ef;border-radius:14px"><tr><td style="padding:24px 28px;border-bottom:1px solid #e7edf5"><img src="${testingLogo}" alt="screenings4u" style="max-width:220px;height:auto"></td></tr><tr><td style="padding:28px"><h1 style="font-size:22px;color:#153e75">${subject}</h1><p style="line-height:1.6">${String(args.body||"")}</p>${args.url?`<p><a href="${args.url}" style="display:inline-block;background:#244f8d;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">${String(args.button||"Open Customer Portal")}</a></p>`:""}</td></tr></table></td></tr></table></body></html>`;

   const row:any={event_type:args.event_type||"order_paid",related_entity_type:args.entity_type||"order",related_entity_id:args.entity_id||null,recipient_user_id:args.user_id||null,recipient_email:email,subject,provider:"resend",status:"queued",metadata:{brand:"screenings4u",logo_url:testingLogo,order_id:args.order_id||null},created_at:now};

   const key=Deno.env.get("RESEND_API_KEY")||"";

   if(!key){row.status="skipped";row.error_message="RESEND_API_KEY not configured";await db.from("testing_email_events").insert(row);return}

   try{const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("SCREENINGS4U_FROM_EMAIL")||"screenings4u <notifications@screenings4u.com>",to:[email],subject,html})});const body=await rr.json().catch(()=>({}));row.status=rr.ok?"sent":"failed";row.provider_message_id=body?.id||null;row.error_message=rr.ok?null:(body?.message||`HTTP ${rr.status}`);row.sent_at=rr.ok?now:null}catch(e){row.status="failed";row.error_message=e instanceof Error?e.message:String(e)}

   await db.from("testing_email_events").insert(row);

 };

 const submitReadyLabcorpOrder=async(orderId:string)=>{
  if(Deno.env.get("LABCORP_AUTO_CERT_ENABLED")!=="true")return {submitted:false,reason:"disabled"};
  const headers={"Authorization":"Bearer "+service,"apikey":service,"Content-Type":"application/json"};
  const pre=await fetch(url+"/functions/v1/testing-labcorp-auto-preflight",{method:"POST",headers,body:JSON.stringify({order_id:orderId})});
  if(!pre.ok)throw new Error("Labcorp preflight HTTP "+pre.status);
  const readiness=await pre.json();
  if(readiness.ready!==true)return {submitted:false,checks:readiness.checks||[]};
  const res=await fetch(url+"/functions/v1/testing-labcorp-auto-worker",{method:"POST",headers,body:JSON.stringify({order_id:orderId})});
  if(!res.ok)throw new Error("Labcorp worker HTTP "+res.status);
  return await res.json();
};

const fulfillTestingOrder=async(orderId:string)=>{

   if(!orderId)return;

   const oq=await db.from("orders").select("*").eq("id",orderId).maybeSingle();if(oq.error)throw oq.error;const order:any=oq.data;if(!order||!order.user_id)return;

   const iq=await db.from("order_items").select("*,services(*)").eq("order_id",orderId);if(iq.error)throw iq.error;

   const items=(iq.data||[]).filter((x:any)=>x.services?.metadata?.public_site==="screenings4u"&&x.services?.metadata?.public_catalog===true&&(x.services?.metadata?.testing_operation===true||x.services?.metadata?.labcorp_fulfillment===true));
   const processingItems=items.filter((x:any)=>x.metadata?.assignment_deferred!==true);

   if(!items.length)return;

   const access=await db.from("testing_customer_portal_access").upsert({user_id:order.user_id,status:"active",access_source:"purchase",first_enabled_at:now,suspended_at:null,revoked_at:null,updated_at:now,metadata:{last_order_id:orderId}},{onConflict:"user_id"});if(access.error)throw access.error;

   if(processingItems.length===0 && items.length>0){
     if(order.metadata?.donor_assignment_notification_sent!==true){
       const nq=await db.from("notifications").insert({recipient_user_id:order.user_id,channel:"in_app",status:"queued",subject:"Assign donors to your purchased tests",body:`Order ${order.order_number} is paid. Assign each donor in your Customer Portal before tests can be processed.`,metadata:{kind:"testing_donor_assignment_needed",order_id:orderId,portal_url:testingPortal}});if(nq.error)throw nq.error;
       let actionUrl=testingPortal+"/login.html",button="Open Customer Portal";
       if(order.metadata?.customer_auth_new===true){
         try{const link=await db.auth.admin.generateLink({type:"recovery",email:order.customer_email,options:{redirectTo:testingPortal+"/reset-password.html"}});if(!link.error&&link.data?.properties?.action_link){actionUrl=link.data.properties.action_link;button="Create Your Portal Password"}}catch(e){console.error("customer recovery link generation failed",e)}
       }
       await testingMail({email:order.customer_email,user_id:order.user_id,subject:"Your Screenings4U order is paid — assign donors",body:`Your order ${order.order_number} is confirmed. Please sign in to assign donors for your ${items.length} purchased tests. Donor passes are created after the required donor details are submitted and processed.`,url:actionUrl,button,event_type:"testing_donor_assignment_needed",entity_type:"order",entity_id:orderId,order_id:orderId});
       const up=await db.from("orders").update({metadata:{...(order.metadata||{}),donor_assignment_notification_sent:true,donor_assignment_status:"awaiting_donors"},updated_at:now}).eq("id",orderId);if(up.error)throw up.error;
     }
     return;
   }
   for(const item of processingItems){

     const s:any=item.services||{},m:any=s.metadata||{},storedDonor:any=item.metadata?.labcorp_donor||order.metadata?.labcorp_donor||{};
     const customerName=[order.customer_first_name,order.customer_last_name].filter(Boolean).join(" ")||null;
     const donorName=[storedDonor.first_name,storedDonor.last_name].filter(Boolean).join(" ")||customerName;
     const donorEmail=String(storedDonor.email||order.customer_email||"").trim().toLowerCase()||null;
     const donorPhone=String(storedDonor.phone||order.customer_phone||"").trim()||null;
     let caseRow:any=null;

     const existing=await db.from("testing_cases").select("*").eq("order_item_id",item.id).maybeSingle();if(existing.error)throw existing.error;
     if(existing.data){
       caseRow=existing.data;
     }else{
       const row:any={
         order_id:orderId,order_item_id:item.id,service_id:s.id,customer_user_id:order.user_id,employer_id:order.employer_id||null,
         customer_name:customerName,customer_email:order.customer_email,company_name:order.company_name||null,
         donor_name:donorName,donor_email:donorEmail,donor_phone:donorPhone,
         dot_test:m.testing_scope==="dot",dot_agency:storedDonor.testing_authority||m.dot_agency||null,
         test_reason:storedDonor.reason_for_test||m.test_reason||null,test_type:s.name,specimen_type:m.specimen||null,panel_name:s.name,
         priority:"normal",status:"awaiting_schedule",mro_required:!!m.mro_required,result_payload:{},
         metadata:{source:"screenings4u_checkout",service_slug:s.slug,tracking_number:order.tracking_number,labcorp_eligible:m.labcorp_fulfillment===true,labcorp_donor:storedDonor},
         created_at:now,updated_at:now
       };
       const ins=await db.from("testing_cases").insert(row).select("*").single();if(ins.error)throw ins.error;caseRow=ins.data;
     }

     if(m.labcorp_fulfillment===true){
       const existingLab=await db.from("testing_labcorp_orders").select("*").eq("order_item_id",item.id).maybeSingle();if(existingLab.error)throw existingLab.error;
       let lab:any=existingLab.data;
       if(!lab){
         const exp=new Date(Date.now()+7*86400000).toISOString();
         const panels=Array.isArray(m.labcorp_panel_ids)?m.labcorp_panel_ids.map((x:any)=>String(x)).filter(Boolean):[];
         const mappings=panels.length?await db.from("testing_labcorp_account_panels").select("panel_id,mapping_status,enabled_for_submission,product_sku").eq("environment","cert").eq("account_number",String(m.labcorp_account_number||"")).in("panel_id",panels):{data:[],error:null};
         if(mappings.error)throw mappings.error;
         const verified=panels.length>0&&panels.every((id:string)=>(mappings.data||[]).some((x:any)=>x.panel_id===id&&x.mapping_status==="approved"&&x.enabled_for_submission===true));
         const mappingBlocker=!panels.length?"No Labcorp panel assigned to purchased service.":!verified?"Labcorp panel mapping not approved for purchased service.":null;
         const lq=await db.from("testing_labcorp_orders").insert({
           id:crypto.randomUUID(),order_id:orderId,order_item_id:item.id,testing_case_id:caseRow.id,customer_user_id:order.user_id,employer_id:order.employer_id||null,
           status:"draft",account_number:String(m.labcorp_account_number||"")||null,account_location_code:String(m.labcorp_account_location_code||m.labcorp_account_number||"")||null,
           panel_ids:panels,donor_first_name:storedDonor.first_name||order.customer_first_name||null,donor_middle_initial:storedDonor.middle_initial||null,donor_last_name:storedDonor.last_name||order.customer_last_name||null,
           donor_email:donorEmail,donor_phone:donorPhone,donor_id:storedDonor.donor_id||null,donor_state_of_residence:storedDonor.state_of_residence||order.billing_state||null,
           donor_reason_for_test:storedDonor.reason_for_test||m.labcorp_reason_for_test||m.test_reason||"NI",donor_date_of_birth:storedDonor.date_of_birth||null,
           cdl_state:storedDonor.cdl_state||null,cdl_number:storedDonor.cdl_number||null,observed_collection_requested:storedDonor.observed_collection_requested===true,
           split_specimen_requested:m.testing_scope==="dot"||storedDonor.split_specimen_requested===true,testing_authority:storedDonor.testing_authority||null,registration_expiration_at:exp,
           notes:"Created automatically from paid screenings4u.com order.",metadata:{source:"stripe_webhook",service_id:s.id,service_slug:s.slug,service_name:s.name,tracking_number:order.tracking_number,panel_mapping_ready:verified,panel_mapping_blocker:mappingBlocker,automatic_submission_enabled:false},
           created_by:null,updated_by:null,created_at:now,updated_at:now
         }).select("*").single();if(lq.error)throw lq.error;lab=lq.data;
         const le=await db.from("testing_labcorp_order_events").insert({id:crypto.randomUUID(),labcorp_order_id:lab.id,event_type:"created_from_paid_order",direction:"internal",payload:{order_id:orderId,order_item_id:item.id,testing_case_id:caseRow.id,service_slug:s.slug},created_at:now});if(le.error)throw le.error;
       }else if(!lab.testing_case_id){
         const lu=await db.from("testing_labcorp_orders").update({testing_case_id:caseRow.id,updated_at:now}).eq("id",lab.id);if(lu.error)throw lu.error;
       }

       const passExisting=await db.from("testing_donor_passes").select("*").eq("testing_case_id",caseRow.id).maybeSingle();if(passExisting.error)throw passExisting.error;
       if(!passExisting.data){
         const deadline=lab.registration_expiration_at||new Date(Date.now()+7*86400000).toISOString();
         const dp=await db.from("testing_donor_passes").insert({
           id:crypto.randomUUID(),status:"draft",testing_case_id:caseRow.id,order_id:orderId,employer_id:order.employer_id||null,customer_user_id:order.user_id,
           donor_name:donorName||"Donor",donor_email:donorEmail,donor_phone:donorPhone,company_name:order.company_name||null,
           test_reason:storedDonor.reason_for_test||m.test_reason||null,test_type:s.name,specimen_type:m.specimen||null,panel_name:s.name,
           dot_test:m.testing_scope==="dot",dot_agency:storedDonor.testing_authority||m.dot_agency||null,collection_deadline:deadline,
           instructions:"Your Labcorp registration is being prepared. Collection-site and registration details will appear here when available.",
           metadata:{source:"stripe_webhook",labcorp_order_id:lab.id,labcorp_order_number:lab.labcorp_order_number,labcorp_registration_status:lab.status,service_slug:s.slug,tracking_number:order.tracking_number},
           created_at:now,updated_at:now
         });if(dp.error)throw dp.error;
       }
     }else{
       const passExisting=await db.from("testing_donor_passes").select("id").eq("testing_case_id",caseRow.id).maybeSingle();if(passExisting.error)throw passExisting.error;
       if(!passExisting.data){
         const dp=await db.from("testing_donor_passes").insert({
           id:crypto.randomUUID(),status:"draft",testing_case_id:caseRow.id,order_id:orderId,employer_id:order.employer_id||null,customer_user_id:order.user_id,
           donor_name:donorName||"Donor",donor_email:donorEmail,donor_phone:donorPhone,company_name:order.company_name||null,
           test_reason:storedDonor.reason_for_test||m.test_reason||null,test_type:s.name,specimen_type:m.specimen||null,panel_name:s.name,
           dot_test:m.testing_scope==="dot",dot_agency:storedDonor.testing_authority||m.dot_agency||null,
           instructions:"Your testing order is confirmed. Collection instructions will appear here when your collection details are ready.",
           metadata:{source:"stripe_webhook",service_slug:s.slug,tracking_number:order.tracking_number,fulfillment:"non_labcorp",order_item_id:item.id},
           created_at:now,updated_at:now
         });if(dp.error)throw dp.error;
       }
     }

   }

   const nq=await db.from("notifications").insert({recipient_user_id:order.user_id,channel:"in_app",status:"queued",subject:"Your screenings4u testing order is active",body:`Order ${order.order_number} is now available in your Testing Customer Portal.`,metadata:{kind:"testing_order_paid",order_id:orderId,portal_url:testingPortal}});if(nq.error)throw nq.error;

   let actionUrl=testingPortal+"/login.html",button="Open Customer Portal";

   if(order.metadata?.customer_auth_new===true){

     try{const link=await db.auth.admin.generateLink({type:"recovery",email:order.customer_email,options:{redirectTo:testingPortal+"/reset-password.html"}});if(!link.error&&link.data?.properties?.action_link){actionUrl=link.data.properties.action_link;button="Create Your Portal Password"}}catch(e){console.error("testing recovery link generation failed",e)}

   }

   await testingMail({email:order.customer_email,user_id:order.user_id,subject:"Your screenings4u Testing Order Is Ready",body:`Thank you for your purchase. Order ${order.order_number} is active. If your service uses Labcorp, your donor pass and collection instructions will appear in the screenings4u Customer Portal as the lab registration is prepared.`,url:actionUrl,button,event_type:"testing_order_paid",entity_type:"order",entity_id:orderId,order_id:orderId});

   if(order.discount_code_id&&Number(order.discount_amount||0)>0){const ex=await db.from("discount_redemptions").select("id").eq("order_id",orderId).maybeSingle();if(ex.error)throw ex.error;if(!ex.data){const dr=await db.from("discount_redemptions").insert({discount_code_id:order.discount_code_id,order_id:orderId,user_id:order.user_id,customer_email:order.customer_email,discount_amount:order.discount_amount,metadata:{source:"screenings4u_checkout"}});if(dr.error)throw dr.error}}

   const meta={...(order.metadata||{}),testing_fulfilled_at:now};const up=await db.from("orders").update({fulfillment_status:"processing",metadata:meta,updated_at:now}).eq("id",orderId);if(up.error)throw up.error;

 };



 const trainingPortal="https://lms.screenings4u.com";

 const fulfillTrainingOrder=async(orderId:string)=>{

   if(!orderId)return;

   const oq=await db.from("orders").select("*").eq("id",orderId).maybeSingle();if(oq.error)throw oq.error;const order:any=oq.data;if(!order||order.fulfillment_type!=="training"||!order.user_id)return;

   const iq=await db.from("order_items").select("*,lms_training_products(*)").eq("order_id",orderId);if(iq.error)throw iq.error;

   let summary:string[]=[];

   for(const item of iq.data||[]){

     const product:any=item.lms_training_products||null;if(!product)continue;

     const kind=String(product.product_kind||item.metadata?.product_kind||"");

     if(kind==="course"){

       const ex=await db.from("lms_enrollments").select("*").eq("user_id",order.user_id).eq("course_id",product.course_id).maybeSingle();if(ex.error)throw ex.error;

       if(!ex.data){const days=Number(product.access_days||60),en=await db.from("lms_enrollments").insert({id:crypto.randomUUID(),user_id:order.user_id,course_id:product.course_id,order_item_id:item.id,status:"active",progress_percent:0,enrolled_at:now,last_activity_at:now,assignment_source:"customer_purchase",expires_at:days>0?new Date(Date.now()+days*86400000).toISOString():null,metadata:{source:"paid_training_order",order_id:orderId,training_product_id:product.id},created_at:now,updated_at:now});if(en.error)throw en.error}

       summary.push(product.name);

     } else if(kind==="group"){

       const ex=await db.from("lms_group_seat_purchases").select("id").eq("order_item_id",item.id).maybeSingle();if(ex.error)throw ex.error;

       if(!ex.data){const g=await db.from("lms_group_seat_purchases").insert({id:crypto.randomUUID(),purchaser_user_id:order.user_id,product_id:product.id,course_id:product.course_id,order_id:orderId,order_item_id:item.id,seats_purchased:Number(product.seat_count||1),seats_used:0,status:"active",metadata:{source:"paid_training_order",access_days:product.access_days||60},created_at:now,updated_at:now});if(g.error)throw g.error}

       summary.push(`${product.name} (${product.seat_count||1} seats)`);

     } else if(kind==="extension"){

       const enrollmentId=String(item.metadata?.target_enrollment_id||order.metadata?.target_enrollment_id||"");if(!enrollmentId)throw new Error("Training extension order is missing its target enrollment.");

       const ex=await db.from("lms_course_extensions").select("id").eq("order_item_id",item.id).maybeSingle();if(ex.error)throw ex.error;

       if(!ex.data){

         const en=await db.from("lms_enrollments").select("*").eq("id",enrollmentId).eq("user_id",order.user_id).maybeSingle();if(en.error)throw en.error;if(!en.data)throw new Error("Training enrollment for extension was not found.");

         const days=Number(product.access_days||product.metadata?.extension_days||30),base=en.data.expires_at&&new Date(en.data.expires_at)>new Date()?new Date(en.data.expires_at):new Date(),next=new Date(base.getTime()+days*86400000).toISOString();

         const up=await db.from("lms_enrollments").update({expires_at:next,extension_days_total:Number(en.data.extension_days_total||0)+days,updated_at:now}).eq("id",enrollmentId);if(up.error)throw up.error;

         const ext=await db.from("lms_course_extensions").insert({id:crypto.randomUUID(),enrollment_id:enrollmentId,user_id:order.user_id,course_id:en.data.course_id,order_id:orderId,order_item_id:item.id,days_added:days,previous_expires_at:en.data.expires_at||null,new_expires_at:next,purchased_at:now,metadata:{training_product_id:product.id}});if(ext.error)throw ext.error;

       }

       summary.push(product.name);

     } else if(kind==="supplies"){

       summary.push(product.name);

     }

   }

   if(!summary.length)return;

   const nq=await db.from("notifications").insert({recipient_user_id:order.user_id,channel:"in_app",status:"queued",subject:"Your Learning Center purchase is ready",body:`Order ${order.order_number} has been processed. ${summary.join(", ")}.`,metadata:{kind:"training_order_paid",order_id:orderId,portal_url:trainingPortal}});if(nq.error)throw nq.error;
if(order.discount_code_id&&Number(order.discount_amount||0)>0){const ex=await db.from("discount_redemptions").select("id").eq("order_id",orderId).maybeSingle();if(ex.error)throw ex.error;if(!ex.data){const dr=await db.from("discount_redemptions").insert({discount_code_id:order.discount_code_id,order_id:orderId,user_id:order.user_id,customer_email:order.customer_email,discount_amount:order.discount_amount,metadata:{source:"training_checkout"}});if(dr.error)throw dr.error}}

   const up=await db.from("orders").update({fulfillment_status:"processing",metadata:{...(order.metadata||{}),training_fulfilled_at:now},updated_at:now}).eq("id",orderId);if(up.error)throw up.error;

 };



 const provisionDotCheckout=async(s:any)=>{

   const intentId=String(s?.metadata?.checkout_intent_id||s?.client_reference_id||"");if(!intentId)return;

   const iq=await db.from("workforce_checkout_intents").select("*").eq("id",intentId).maybeSingle();if(iq.error)throw iq.error;if(!iq.data||iq.data.status==="provisioned")return;

   const email=String(s?.customer_details?.email||s?.customer_email||iq.data.email||"").trim().toLowerCase();if(!email)return;

   const meta:any=iq.data.metadata||{},token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-",""),bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)),hash=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");

   const expires=new Date(Date.now()+7*86400000).toISOString(),portal=String(meta.portal_code||""),agency=String(meta.agency_code||"")||null;

   const existing=await db.from("workforce_purchase_intakes").select("*").eq("checkout_intent_id",intentId).maybeSingle();if(existing.error)throw existing.error;

   if(!existing.data){const ins=await db.from("workforce_purchase_intakes").insert({id:crypto.randomUUID(),checkout_intent_id:intentId,plan_id:iq.data.plan_id,account_type:iq.data.account_type,email,agency_code:agency,portal_code:portal||null,status:"pending",intake_data:{},token,token_hash:hash,token_expires_at:expires,created_at:now,updated_at:now});if(ins.error)throw ins.error}

   const up=await db.from("workforce_checkout_intents").update({email,status:"paid",stripe_checkout_session_id:s.id,stripe_customer_id:typeof s.customer==="string"?s.customer:null,stripe_subscription_id:typeof s.subscription==="string"?s.subscription:null,paid_at:iq.data.paid_at||now,metadata:{...meta,checkout_amount_total:s.amount_total??meta.amount,currency:s.currency||meta.currency},updated_at:now}).eq("id",intentId);if(up.error)throw up.error;

 };

 const activateCtpaSubscription=async(sub:any)=>{

   if(!sub?.ctpa_id||String(sub.status)!=="active")return;

   const cq=await db.from("ctpas").select("id,tenant_id,organization_id,status").eq("id",sub.ctpa_id).maybeSingle();if(cq.error)throw cq.error;if(!cq.data)return;

   const ctpa=cq.data,now2=new Date().toISOString();

   const pa=await db.from("organization_portal_access").select("*").eq("organization_id",ctpa.organization_id).eq("portal_code","ctpa_dot").maybeSingle();if(pa.error)throw pa.error;

   const parow:any={tenant_id:ctpa.tenant_id,organization_id:ctpa.organization_id,portal_code:"ctpa_dot",enabled:true,access_source:"subscription",subscription_id:sub.id,enabled_at:pa.data?.enabled_at||now2,disabled_at:null,updated_at:now2,metadata:{...(pa.data?.metadata||{}),activated_by:"stripe_webhook"}};

   const pu=pa.data?await db.from("organization_portal_access").update(parow).eq("id",pa.data.id):await db.from("organization_portal_access").insert({id:crypto.randomUUID(),...parow,created_at:now2});if(pu.error)throw pu.error;

   const mq=await db.from("organization_memberships").select("*").eq("organization_id",ctpa.organization_id).eq("status","active").order("is_primary",{ascending:false}).order("created_at").limit(1).maybeSingle();if(mq.error)throw mq.error;if(!mq.data)return;

   const pq=await db.from("user_profiles").select("email,first_name,last_name").eq("id",mq.data.user_id).maybeSingle();if(pq.error)throw pq.error;const email=String(pq.data?.email||"").trim().toLowerCase();if(!email)return;

   try{

     const link=await db.auth.admin.generateLink({type:"recovery",email,options:{redirectTo:"https://ctpa-dot.screenings4u.com/reset-password.html"}});

     const href=link.data?.properties?.action_link,key=Deno.env.get("RESEND_API_KEY")||"";

     if(!link.error&&href&&key){

       const nm=[pq.data?.first_name,pq.data?.last_name].filter(Boolean).join(" ")||email;

       await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("SCREENINGS4U_FROM_EMAIL")||"screenings4u <notifications@screenings4u.com>",to:[email],subject:"Your screenings4u DOT C/TPA Portal is active",html:'<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#17365f"><table width="100%" role="presentation"><tr><td align="center" style="padding:28px 14px"><table width="620" style="max-width:620px;background:#fff;border:1px solid #dbe4ef;border-radius:14px;overflow:hidden"><tr><td style="background:#102f55;padding:20px 24px"><img src="https://elpbnytpciqnbexiaebp.supabase.co/storage/v1/object/public/enterprise_branding/logo2.png" alt="screenings4u DOT" style="max-width:220px;height:auto"></td></tr><tr><td style="padding:28px"><h1 style="font-size:24px;margin:0 0 14px">Your C/TPA DOT Portal is active</h1><p>Hello '+nm+',</p><p>Your subscription payment has been confirmed and portal access is now active.</p><p style="margin:24px 0"><a href="'+href+'" style="display:inline-block;background:#ef6c00;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Create Password & Open Portal</a></p><p style="font-size:13px;color:#6b7c93">Portal: https://ctpa-dot.screenings4u.com/login.html</p></td></tr></table></td></tr></table></body></html>'})});

     }

   }catch(e){console.error("ctpa activation email failed",e)}

 };

 const updateSubscription=async(s:any)=>{

   const patch:any={

     status:String(s?.status||"active"),

     stripe_customer_id:typeof s?.customer==="string"?s.customer:s?.customer?.id||null,

     stripe_subscription_id:s?.id||null,

     stripe_price_id:s?.items?.data?.[0]?.price?.id||null,

     stripe_current_period_end:s?.current_period_end?new Date(s.current_period_end*1000).toISOString():null,

     cancel_at_period_end:!!s?.cancel_at_period_end,

     updated_at:now

   };

   for(const table of ["subscriptions","workforce_subscriptions"]){

     const r=await db.from(table).update(patch).eq("stripe_subscription_id",s?.id||"__none__").select("*");

     if(r.error)throw r.error;

     if(table==="subscriptions"&&String(patch.status)==="active")for(const sub of r.data||[])await activateCtpaSubscription(sub);

   }

 };

 try{

   switch(event.type){

     case "payment_intent.succeeded":
       if(event.data.object?.metadata?.source==="workforce_proposal_invoice"){
         const invoiceId=String(event.data.object.metadata.invoice_id||"");
         if(invoiceId){
           const nr=await fetch(url+"/functions/v1/workforce-invoice-paid-emails",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+service,"apikey":service},body:JSON.stringify({invoice_id:invoiceId})});
           if(!nr.ok)console.error("Workforce invoice receipt dispatch",nr.status,await nr.text());
         }
         break;
       }


       await updateOrder(event.data.object,true);
       if(event.data.object?.metadata?.service_slug && String(event.data.object.metadata.service_slug)!=="checkout-test-one-dollar"){
         const paidOrderId=String(event.data.object?.metadata?.order_id||"");
         if(paidOrderId){
           try{
             const mailResponse=await fetch(url+"/functions/v1/website-paid-order-emails",{method:"POST",headers:{"Content-Type":"application/json","apikey":service,"Authorization":"Bearer "+service},body:JSON.stringify({order_id:paidOrderId})});
             if(!mailResponse.ok)console.error("website order email dispatch",mailResponse.status,await mailResponse.text());
           }catch(emailError){console.error("website order email dispatch",emailError)}
         }
       }
       break;

     case "payment_intent.payment_failed":

     case "charge.failed":

       if(event.data.object?.object==="payment_intent")await updateOrder(event.data.object,false);

       break;

     case "checkout.session.completed":

     case "checkout.session.async_payment_succeeded":{

       const s=event.data.object;

       if(String(s?.metadata?.surface||"")==="dot_marketing" && s?.payment_status!=="unpaid") await provisionDotCheckout(s);

       const adminOrderId=String(s?.metadata?.order_id||"");if(adminOrderId&&s?.payment_status!=="unpaid"){const ao=await db.from("orders").update({payment_status:"paid",status:"completed",payment_provider:"stripe",payment_reference:String(s.payment_intent||s.subscription||s.id),stripe_checkout_session_id:s.id,paid_at:now,fulfilled_at:now,fulfillment_status:"completed",updated_at:now}).eq("id",adminOrderId);if(ao.error)throw ao.error;await provisionLabAccountIntake(adminOrderId);}

       if(s?.payment_intent){

         const order=await db.from("orders").update({

           payment_status:"paid",status:"processing",payment_provider:"stripe",

           payment_reference:String(s.payment_intent),stripe_payment_intent_id:String(s.payment_intent),

           stripe_checkout_session_id:s.id,paid_at:now,updated_at:now

         }).or(`stripe_checkout_session_id.eq.${s.id},id.eq.${s?.metadata?.order_id||"00000000-0000-0000-0000-000000000000"}`);

         if(order.error)throw order.error;

         const checkoutOrderId=String(s?.metadata?.order_id||"");

         if(checkoutOrderId){await provisionLabAccountIntake(checkoutOrderId);await grantTestingEmployerTraining(checkoutOrderId);await grantDirectTraining(checkoutOrderId);await fulfillTestingOrder(checkoutOrderId);await fulfillTrainingOrder(checkoutOrderId);try{await submitReadyLabcorpOrder(checkoutOrderId)}catch(e){console.error("Labcorp handoff failed",e)}}

       }

       for(const table of ["subscriptions","workforce_subscriptions"]){

         const r=await db.from(table).update({

           stripe_checkout_session_id:s.id,

           stripe_customer_id:typeof s.customer==="string"?s.customer:null,

           ...(s.subscription?{stripe_subscription_id:String(s.subscription)}:{}),

           status:s.payment_status==="paid"?"active":"trial",

           updated_at:now

         }).eq("stripe_checkout_session_id",s.id).select("*");

         if(r.error)throw r.error;

         if(table==="subscriptions"&&s.payment_status==="paid")for(const sub of r.data||[])await activateCtpaSubscription(sub);

       }

       break;

     }

     case "customer.subscription.created":

     case "customer.subscription.updated":

     case "customer.subscription.deleted":

       await updateSubscription(event.data.object);break;

     case "invoice.paid":

     case "invoice.payment_failed":{

       const i=event.data.object,paid=event.type==="invoice.paid";

       const inv=await db.from("invoices").update({

         status:paid?"paid":"open",

         ...(paid?{amount_paid:Number(i.amount_paid||0)/100,amount_due:Number(i.amount_remaining||0)/100,paid_at:now}:{}),

         updated_at:now

       }).eq("stripe_invoice_id",i.id);

       if(inv.error)throw inv.error;

       const winv=await db.from("workforce_invoices").update({

         status:paid?"paid":"open",

         ...(paid?{amount_paid:Number(i.amount_paid||0)/100,amount_due:Number(i.amount_remaining||0)/100,paid_at:now}:{}),

         updated_at:now

       }).eq("external_invoice_id",i.id);

       if(winv.error)throw winv.error;

       break;

     }

     default: break;

   }

   return json({received:true});

 }catch(e){console.error("stripe-webhook event handling failed",event?.id,event?.type,e);return json({error:e instanceof Error?e.message:String(e)},500)}

});