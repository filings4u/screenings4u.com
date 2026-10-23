import {createClient} from "npm:@supabase/supabase-js@2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,apikey,authorization,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...H,"Content-Type":"application/json","Cache-Control":"no-store"}});
const C=(x:any)=>String(x??"").trim();
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return J({error:"Method not allowed."},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!anon||!service)throw fail("Customer portal unavailable.",503);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)throw fail("Authentication required.",401);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const user=await auth.auth.getUser(token);if(user.error||!user.data.user)throw fail("Authentication required.",401);
  const uid=user.data.user.id;
  const access=await db.from("testing_customer_portal_access").select("status").eq("user_id",uid).maybeSingle();
  if(access.error)throw access.error;if(!access.data||!["active","enabled"].includes(C(access.data.status).toLowerCase()))throw fail("Customer portal access is not active.",403);
  const b=await req.json().catch(()=>({}));if(C(b.action)!=="assign_donor")throw fail("Unsupported action.");
  const itemId=C(b.order_item_id);if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(itemId))throw fail("A purchased test must be selected.");
  const d=b.donor||{};
  const donor={first_name:C(d.first_name),middle_initial:C(d.middle_initial).toUpperCase(),last_name:C(d.last_name),email:C(d.email).toLowerCase(),phone:C(d.phone),date_of_birth:C(d.date_of_birth),state_of_residence:C(d.state_of_residence).toUpperCase(),reason_for_test:C(d.reason_for_test).toUpperCase(),testing_authority:C(d.testing_authority).toUpperCase(),cdl_state:C(d.cdl_state).toUpperCase(),cdl_number:C(d.cdl_number),observed_collection_requested:d.observed_collection_requested===true,split_specimen_requested:d.split_specimen_requested===true};
  if(!donor.first_name||!donor.last_name||donor.first_name.length>100||donor.last_name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donor.email)||!/^[A-Z]{2}$/.test(donor.state_of_residence)||!["PE","RN","PA","RS","RT","FU","NI"].includes(donor.reason_for_test)||!/^\d{4}-\d{2}-\d{2}$/.test(donor.date_of_birth)||!Number.isFinite(Date.parse(donor.date_of_birth))||new Date(donor.date_of_birth)>new Date()||donor.middle_initial.length>1||donor.phone.length>35||donor.cdl_number.length>60)throw fail("Please complete the donor details correctly.");
  if(donor.testing_authority&&!["FMCSA","FAA","FRA","FTA","PHMSA","USCG"].includes(donor.testing_authority))throw fail("Invalid DOT authority.");
  const iq=await db.from("order_items").select("*,services(*)").eq("id",itemId).maybeSingle();if(iq.error)throw iq.error;
  const item=iq.data;if(!item)throw fail("Purchased test not found.",404);
  const oq=await db.from("orders").select("*").eq("id",item.order_id).eq("user_id",uid).maybeSingle();if(oq.error)throw oq.error;const order=oq.data;
  if(!order)throw fail("This order is not owned by your account.",403);
  if(order.payment_status!=="paid")throw fail("The order must be paid before assigning a donor.",409);
  const m=item.services?.metadata||{},old=item.metadata||{};
  if(!m.public_catalog||m.public_site!=="screenings4u"||m.testing_operation!==true||old.assignment_deferred!==true||Number(item.quantity)!==1)throw fail("This test is not eligible for deferred donor assignment.",409);
  if(m.testing_scope==="dot"&&!donor.testing_authority)throw fail("DOT testing authority is required for this test.");
  if(old.assignment_status==="assigned")return J({ok:true,already_assigned:true,order_item_id:itemId,testing_case_id:old.testing_case_id||null});
  const now=new Date().toISOString(),name=[donor.first_name,donor.last_name].join(" "),meta={source:"screenings4u_customer_portal",service_slug:item.services.slug,labcorp_eligible:m.labcorp_fulfillment===true,labcorp_donor:donor,order_item_id:itemId};
  // Idempotent record creation: retries repair missing dependent rows rather than creating a second case/pass.
  const existing=await db.from("testing_cases").select("*").eq("order_item_id",itemId).limit(1).maybeSingle();if(existing.error)throw existing.error;
  let test=existing.data;
  if(!test){
    const q=await db.from("testing_cases").insert({order_id:order.id,order_item_id:itemId,service_id:item.service_id,customer_user_id:uid,customer_name:[order.customer_first_name,order.customer_last_name].filter(Boolean).join(" "),customer_email:order.customer_email,donor_name:name,donor_email:donor.email,donor_phone:donor.phone,dot_test:m.testing_scope==="dot",dot_agency:donor.testing_authority||m.dot_agency||null,test_reason:donor.reason_for_test,test_type:item.services.name,specimen_type:m.specimen||null,panel_name:item.services.name,priority:"normal",status:"awaiting_schedule",mro_required:!!m.mro_required,metadata:meta,created_at:now,updated_at:now}).select("*").single();if(q.error)throw q.error;test=q.data;
  }
  let lab:any=null;
  if(m.labcorp_fulfillment===true){
    const q=await db.from("testing_labcorp_orders").select("*").eq("order_item_id",itemId).limit(1).maybeSingle();if(q.error)throw q.error;lab=q.data;
    if(!lab){
      const panels=Array.isArray(m.labcorp_panel_ids)?m.labcorp_panel_ids.map((x:any)=>C(x)).filter(Boolean):[];
      const account=C(m.labcorp_account_number);
      const locationCode=C(m.labcorp_account_location_code||m.labcorp_location_code||account);
      if(!account||!locationCode)throw fail("Labcorp account mapping is missing for this service.",409);
      const lm=panels.length?await db.from("testing_labcorp_account_panels").select("panel_id,mapping_status,enabled_for_submission,product_sku").eq("environment","cert").eq("account_number",account).eq("account_location_code",locationCode).in("panel_id",panels):{data:[],error:null};
      if(lm.error)throw lm.error;
      const mapped=panels.length>0&&panels.every((id:string)=>(lm.data||[]).some((x:any)=>x.panel_id===id&&x.mapping_status==="approved"&&x.enabled_for_submission===true&&x.product_sku===item.services.slug));
      const q2=await db.from("testing_labcorp_orders").insert({order_id:order.id,order_item_id:itemId,testing_case_id:test.id,customer_user_id:uid,status:"draft",account_number:account,account_location_code:locationCode,panel_ids:panels,donor_first_name:donor.first_name,donor_middle_initial:donor.middle_initial||null,donor_last_name:donor.last_name,donor_email:donor.email,donor_phone:donor.phone,donor_state_of_residence:donor.state_of_residence,donor_reason_for_test:donor.reason_for_test,donor_date_of_birth:donor.date_of_birth,cdl_state:donor.cdl_state||null,cdl_number:donor.cdl_number||null,observed_collection_requested:donor.observed_collection_requested,split_specimen_requested:m.testing_scope==="dot"||donor.split_specimen_requested,testing_authority:donor.testing_authority||null,registration_expiration_at:new Date(Date.now()+7*86400000).toISOString(),notes:"Created after customer donor assignment; registration pending coordination.",metadata:{source:"screenings4u_customer_portal",service_slug:item.services.slug,panel_mapping_ready:mapped,panel_mapping_blocker:mapped?null:"Labcorp panel mapping requires review.",automatic_submission_enabled:false},created_at:now,updated_at:now}).select("*").single();if(q2.error)throw q2.error;lab=q2.data;
      const ev=await db.from("testing_labcorp_order_events").insert({labcorp_order_id:lab.id,event_type:"created_from_donor_assignment",direction:"internal",payload:{order_id:order.id,order_item_id:itemId,testing_case_id:test.id}});if(ev.error)throw ev.error;
    }
  }
  const passes=await db.from("testing_donor_passes").select("id").eq("testing_case_id",test.id).limit(1).maybeSingle();if(passes.error)throw passes.error;
  if(!passes.data){
    const row={status:"draft",testing_case_id:test.id,order_id:order.id,customer_user_id:uid,donor_name:name,donor_email:donor.email,donor_phone:donor.phone,test_reason:donor.reason_for_test,test_type:item.services.name,specimen_type:m.specimen||null,panel_name:item.services.name,dot_test:m.testing_scope==="dot",dot_agency:donor.testing_authority||null,collection_deadline:lab?.registration_expiration_at||null,instructions:lab?"Labcorp registration is being prepared. Your collection-site information will appear when confirmed.":"Your test is awaiting collection coordination. A pass will be issued when the required details are ready.",metadata:{source:"screenings4u_customer_portal",order_item_id:itemId,labcorp_order_id:lab?.id||null,labcorp_registration_status:lab?.status||null},created_at:now,updated_at:now};
    const dp=await db.from("testing_donor_passes").insert(row);if(dp.error)throw dp.error;
  }
  const updated=await db.from("order_items").update({metadata:{...old,assignment_status:"assigned",assigned_donor:donor,assignment_deferred:true,assigned_at:now,testing_case_id:test.id,labcorp_order_id:lab?.id||null}}).eq("id",itemId);if(updated.error)throw updated.error;
  const remain=await db.from("order_items").select("id,metadata").eq("order_id",order.id);if(remain.error)throw remain.error;
  const unassigned=(remain.data||[]).filter((x:any)=>x.metadata?.assignment_deferred===true&&x.metadata?.assignment_status!=="assigned").length;
  if(unassigned===0){const q=await db.from("orders").update({metadata:{...(order.metadata||{}),donor_assignment_status:"all_assigned",donor_assignments_completed_at:now},updated_at:now}).eq("id",order.id);if(q.error)throw q.error}
  // Automatically hand off an eligible paid order to the server-side
  // registration gateway; no staff approval is required.
  let registration:any={status:"not_applicable"};
  if(lab && !lab.labcorp_registration_number && C(lab.status)==="draft"){
    try{
      const result=await fetch(url+"/functions/v1/testing-labcorp-run-paid-order",{
        method:"POST",
        headers:{"Authorization":"Bearer "+service,"apikey":service,"Content-Type":"application/json"},
        body:JSON.stringify({order_id:order.id}),
        signal:AbortSignal.timeout(65000)
      });
      const outcome=await result.json().catch(()=>({error:"Invalid registration response"}));
      registration={status:result.ok?"processed":"blocked",http_status:result.status,details:outcome};
    }catch(err){
      // Unknown result: do not re-submit automatically.
      console.error("Labcorp registration handoff outcome unknown",err);
      registration={status:"reconciliation_required"};
    }
  }
  return J({ok:true,order_item_id:itemId,testing_case_id:test.id,remaining:unassigned,registration});
 }catch(e){console.error("testing-customer-donor-assignment",e);return J({error:e instanceof Error?e.message:"Unable to assign donor."},(e as any)?.status||500)}
});