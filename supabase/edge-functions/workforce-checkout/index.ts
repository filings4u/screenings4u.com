import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const J=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...H,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:any)=>String(v??"").trim();
const PUBLIC_PLAN=/^(dot_(?:ctpa|employer|fmcsa|faa|fra|fta|phmsa|uscg)_(?:essential|professional|enterprise)|owner_operator_(?:essential|plus|complete))$/;

async function sharedAccount(db:any){
  const q=await db.from("finance_payment_accounts").select("id,provider_account_id,livemode,active").eq("provider","stripe").eq("account_key","screenings4u_shared_live").eq("active",true).maybeSingle();
  if(q.error)throw q.error;
  if(!q.data||q.data.livemode!==true)throw new Error("Shared live Stripe account is not configured.");
  return q.data;
}

async function ensureStripeCatalog(db:any,stripe:any,acct:any,plan:any){
  const isOwner=String(plan.audience||"").toLowerCase()==="owner_operator";
  const expected=Math.round(Number(isOwner?(plan.annual_price??plan.billing_model?.amount):plan.monthly_price||plan.billing_model?.amount||0)*100);
  if(!(expected>0))throw new Error("This plan requires manual billing.");
  const frequency=String(isOwner?"yearly":(plan.billing_model?.frequency||"monthly")).toLowerCase();
  const interval=(frequency==="yearly"||frequency==="annual"||frequency==="year")?"year":"month";
  const mq=await db.from("finance_stripe_catalog_map").select("*")
    .eq("payment_account_id",acct.id).eq("legal_entity_code","dot").eq("source_table","plans").eq("source_id",plan.id)
    .eq("billing_type","recurring").eq("billing_interval",interval).maybeSingle();
  if(mq.error)throw mq.error;
  let map=mq.data||null;
  let product:any=null,price:any=null;

  if(map?.stripe_product_id){try{product=await stripe.products.retrieve(map.stripe_product_id)}catch(_){product=null}}
  if(product?.deleted||product?.active!==true||product?.livemode!==true)product=null;

  if(!product){
    const found=await stripe.products.search({query:`active:'true' AND metadata['plan_code']:'${plan.code}'`,limit:10});
    product=(found.data||[]).find((p:any)=>p.livemode===true)||null;
  }
  if(!product){
    product=await stripe.products.create({name:plan.name,description:plan.description||undefined,metadata:{plan_code:plan.code,supabase_plan_id:plan.id,legal_entity_code:"dot",source_table:"plans",surface:"dot.screenings4u.com",catalog_type:"service"}});
  }

  if(map?.stripe_price_id){try{price=await stripe.prices.retrieve(map.stripe_price_id)}catch(_){price=null}}
  if(price && (price.livemode!==true||price.active!==true||price.currency!=="usd"||price.type!=="recurring"||price.recurring?.interval!==interval||Number(price.unit_amount||0)!==expected||String(price.product)!==product.id))price=null;

  if(!price){
    const prices=await stripe.prices.list({product:product.id,active:true,type:"recurring",limit:100});
    price=(prices.data||[]).find((p:any)=>p.livemode===true&&p.currency==="usd"&&p.recurring?.interval===interval&&Number(p.unit_amount||0)===expected)||null;
  }
  if(!price){
    price=await stripe.prices.create({product:product.id,unit_amount:expected,currency:"usd",recurring:{interval},lookup_key:`s4u_${plan.code}_${interval==="year"?"yearly":"monthly"}_live`,metadata:{plan_code:plan.code,supabase_plan_id:plan.id,legal_entity_code:"dot",source_table:"plans",surface:"dot.screenings4u.com",billing_frequency:frequency}});
  }

  const row={payment_account_id:acct.id,legal_entity_code:"dot",source_table:"plans",source_id:plan.id,source_code:plan.code,stripe_product_id:product.id,stripe_price_id:price.id,billing_type:"recurring",billing_interval:interval,currency:"usd",unit_amount:expected,active:true,metadata:{provider_account_id:acct.provider_account_id,surface:"dot.screenings4u.com",catalog_type:"service",billing_frequency:frequency},updated_at:new Date().toISOString()};
  const up=await db.from("finance_stripe_catalog_map").upsert(row,{onConflict:"payment_account_id,legal_entity_code,source_table,source_id,billing_type,billing_interval"});
  if(up.error)throw up.error;
  return {product,price};
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(!["GET","POST"].includes(req.method))return J({error:"Method not allowed."},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",svc=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!svc)return J({error:"Checkout configuration is unavailable."},500);
  const db=createClient(url,svc,{auth:{persistSession:false,autoRefreshToken:false}});

  if(req.method==="GET"){
    const u=new URL(req.url),type=clean(u.searchParams.get("type")||"employer").toLowerCase(),agency=clean(u.searchParams.get("agency")).toUpperCase();
    let q=db.from("plans").select("id,code,name,description,billing_model,employee_limit,driver_limit,included_services,active,audience,monthly_price,annual_price,feature_entitlements").eq("active",true);
    if(type==="ctpa")q=q.eq("audience","ctpa").like("code","dot_ctpa_%");
    else if(type==="owner"||type==="owner_operator")q=q.eq("audience","owner_operator").like("code","owner_operator_%");
    else if(agency&&agency!=="CTPA")q=q.eq("audience","employer").like("code",`dot_${agency.toLowerCase()}_%`);
    else q=q.eq("audience","employer").like("code","dot_employer_%");
    const p=await q.order("name");if(p.error)throw p.error;
    return J({plans:(p.data||[]).filter((x:any)=>PUBLIC_PLAN.test(String(x.code))).map((x:any)=>{
      const owner=String(x.audience||"").toLowerCase()==="owner_operator";
      const out:any={...x,billing_frequency:owner?"yearly":(x.billing_model?.frequency||"monthly")};
      if(owner){out.annual_price=Number(x.annual_price??x.billing_model?.amount??0);delete out.monthly_price}
      return out;
    })});
  }

  const b=await req.json().catch(()=>({})),planCode=clean(b.plan_code),surface=clean(b.surface||"dot_marketing");
  if(surface!=="dot_marketing")return J({error:"Invalid checkout surface."},400);
  if(!PUBLIC_PLAN.test(planCode))return J({error:"The selected DOT plan is not available for public checkout."},400);
  const pq=await db.from("plans").select("*").eq("code",planCode).eq("active",true).maybeSingle();if(pq.error)throw pq.error;
  if(!pq.data)return J({error:"The selected plan is not currently available."},404);
  if(String(pq.data.audience||"").toLowerCase()==="owner_operator"){
    pq.data.billing_model={...(pq.data.billing_model||{}),frequency:"yearly",term_months:12};
    pq.data.monthly_price=null;
  }

  const stripeKey=Deno.env.get("STRIPE_SECRET_KEY")||"",publishable=Deno.env.get("STRIPE_PUBLISHABLE_KEY")||"";
  if(!stripeKey||!publishable)return J({error:"Secure payment is not configured."},503);
  const stripe=new Stripe(stripeKey,{apiVersion:"2025-08-27.basil"});
  const acct=await sharedAccount(db);
  const {product,price}=await ensureStripeCatalog(db,stripe,acct,pq.data);

  const id=crypto.randomUUID(),now=new Date().toISOString(),ref=`DOT-${Date.now().toString(36).toUpperCase()}-${id.slice(0,6).toUpperCase()}`;
  const bm=pq.data.billing_model||{},agency=clean(bm.agency_code).toUpperCase()||null,portal=clean(bm.portal_code)||(pq.data.audience==="ctpa"?"ctpa_dot":pq.data.audience==="owner_operator"?"owner_operator":"employer_dot");
  const billingFrequency=String(pq.data.billing_model?.frequency||"monthly");
  const purchasedProgram=pq.data.audience==="owner_operator"?"OWNER_OPERATOR":pq.data.audience==="ctpa"?"DOT_AND_NON_DOT":"DOT";
  const meta={surface:"dot_marketing",purchased_program:purchasedProgram,plan_code:planCode,agency_code:agency,portal_code:portal,amount:Number(pq.data.monthly_price||0),currency:"usd",billing_frequency:billingFrequency,stripe_price_id:price.id,stripe_product_id:product.id,legal_entity_code:"dot",stripe_account_id:acct.provider_account_id};
  const iq=await db.from("workforce_checkout_intents").insert({id,reference:ref,plan_id:pq.data.id,account_type:pq.data.audience,purchased_program:purchasedProgram,workforce_classification:purchasedProgram==="DOT"?"DOT":null,status:"pending",intake_required:true,metadata:meta,created_at:now,updated_at:now}).select("*").single();if(iq.error)throw iq.error;

  let session:any;
  try{
    session=await stripe.checkout.sessions.create({mode:"subscription",ui_mode:"custom",line_items:[{price:price.id,quantity:1}],return_url:"https://dot.screenings4u.com/checkout-return.html?session_id={CHECKOUT_SESSION_ID}",client_reference_id:id,billing_address_collection:"auto",metadata:{checkout_intent_id:id,plan_id:pq.data.id,plan_code:planCode,surface:"dot_marketing",account_type:pq.data.audience,purchased_program:purchasedProgram,agency_code:agency||"",portal_code:portal,legal_entity_code:"dot",stripe_account_id:acct.provider_account_id},subscription_data:{metadata:{checkout_intent_id:id,plan_id:pq.data.id,plan_code:planCode,surface:"dot_marketing",account_type:pq.data.audience,purchased_program:purchasedProgram,agency_code:agency||"",portal_code:portal,legal_entity_code:"dot",stripe_account_id:acct.provider_account_id}}});
  }catch(e){await db.from("workforce_checkout_intents").update({status:"failed",metadata:{...meta,stripe_error:e instanceof Error?e.message:String(e)},updated_at:new Date().toISOString()}).eq("id",id);throw e}
  const uq=await db.from("workforce_checkout_intents").update({stripe_checkout_session_id:session.id,status:"checkout_started",metadata:{...meta,stripe_livemode:!!session.livemode},updated_at:new Date().toISOString()}).eq("id",id);if(uq.error)throw uq.error;
  return J({client_secret:session.client_secret,stripe_publishable_key:publishable,checkout_session_id:session.id,reference:ref,plan:{id:pq.data.id,code:pq.data.code,name:pq.data.name,price:pq.data.monthly_price,billing_frequency:billingFrequency}});
 }catch(e){console.error("workforce-checkout",e);return J({error:e instanceof Error?e.message:String(e)},500)}
});