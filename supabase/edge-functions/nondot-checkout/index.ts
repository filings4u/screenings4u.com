import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,apikey,x-client-info","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const J=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:H});
const S=(v:any)=>String(v??"").trim();
async function acct(db:any){const q=await db.from("finance_payment_accounts").select("*").eq("provider","stripe").eq("account_key","screenings4u_shared_live").eq("active",true).maybeSingle();if(q.error)throw q.error;if(!q.data||q.data.livemode!==true)throw new Error("Live Stripe account is unavailable.");return q.data}
async function stripePrice(db:any,stripe:any,a:any,p:any){
 const amount=Math.round(Number(p.monthly_price||p.billing_model?.amount||0)*100);if(!(amount>0))throw new Error("Plan price is unavailable.");
 let q=await db.from("finance_stripe_catalog_map").select("*").eq("payment_account_id",a.id).eq("legal_entity_code","workforce_nondot").eq("source_table","workforce_plans").eq("source_id",p.id).eq("billing_type","recurring").eq("billing_interval","month").maybeSingle();if(q.error)throw q.error;
 let product:any=null,price:any=null,m=q.data;
 if(m?.stripe_product_id){try{product=await stripe.products.retrieve(m.stripe_product_id)}catch{}}
 if(product?.deleted||product?.active!==true||product?.livemode!==true)product=null;
 if(!product)product=await stripe.products.create({name:p.name,description:p.description||undefined,metadata:{plan_code:p.code,supabase_plan_id:p.id,surface:"non-dot.screenings4u.com",program:"NON_DOT"}});
 if(m?.stripe_price_id){try{price=await stripe.prices.retrieve(m.stripe_price_id)}catch{}}
 if(price&&(price.active!==true||price.livemode!==true||Number(price.unit_amount||0)!==amount||price.recurring?.interval!=="month"||String(price.product)!==product.id))price=null;
 if(!price)price=await stripe.prices.create({product:product.id,unit_amount:amount,currency:"usd",recurring:{interval:"month"},metadata:{plan_code:p.code,program:"NON_DOT"}});
 const row={payment_account_id:a.id,legal_entity_code:"workforce_nondot",source_table:"workforce_plans",source_id:p.id,source_code:p.code,stripe_product_id:product.id,stripe_price_id:price.id,billing_type:"recurring",billing_interval:"month",currency:"usd",unit_amount:amount,active:true,metadata:{surface:"non-dot.screenings4u.com",program:"NON_DOT"},updated_at:new Date().toISOString()};
 const up=await db.from("finance_stripe_catalog_map").upsert(row,{onConflict:"payment_account_id,legal_entity_code,source_table,source_id,billing_type,billing_interval"});if(up.error)throw up.error;
 return {product,price,amount};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",svc=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";if(!url||!svc)return J({error:"Checkout configuration unavailable."},500);
  const db=createClient(url,svc,{auth:{persistSession:false}});
  if(req.method==="GET"){const q=await db.from("workforce_plans").select("*").eq("active",true).in("audience",["employer","ctpa"]).order("monthly_price");if(q.error)throw q.error;return J({plans:q.data||[]})}
  const b=await req.json().catch(()=>({})),code=S(b.plan_code||b.service||b.plan),id=S(b.plan_id);
  let pq=id?await db.from("workforce_plans").select("*").eq("id",id).eq("active",true).maybeSingle():await db.from("workforce_plans").select("*").eq("code",code).eq("active",true).maybeSingle();if(pq.error)throw pq.error;
  const p=pq.data;if(!p||!["employer","ctpa"].includes(String(p.audience)))return J({error:"Selected NON-DOT plan is unavailable."},404);
  const stripe=new Stripe(Deno.env.get("STRIPE_SECRET_KEY")||"",{apiVersion:"2025-08-27.basil"}),publishable=Deno.env.get("STRIPE_PUBLISHABLE_KEY")||"";if(!publishable)throw new Error("Stripe publishable key is unavailable.");
  const a=await acct(db),sp=await stripePrice(db,stripe,a,p),intentId=crypto.randomUUID(),ts=new Date().toISOString(),ref="ND-"+Date.now().toString(36).toUpperCase()+"-"+intentId.slice(0,6).toUpperCase(),portal=p.audience==="ctpa"?"ctpa_workforce":"employer_workforce";
  const meta={surface:"nondot_marketing",program:"NON_DOT",plan_code:p.code,portal_code:portal,purchased_program:p.audience==="ctpa"?"DOT_AND_NON_DOT":"NON_DOT",amount:Number(p.monthly_price||0),currency:"usd",stripe_price_id:sp.price.id,stripe_product_id:sp.product.id};
  const iq=await db.from("workforce_checkout_intents").insert({id:intentId,reference:ref,plan_id:p.id,account_type:p.audience,first_name:S(b.first_name)||null,last_name:S(b.last_name)||null,email:S(b.email).toLowerCase()||null,organization_name:S(b.organization_name)||null,phone:S(b.phone)||null,status:"pending",workforce_classification:"NON_DOT",purchased_program:p.audience==="ctpa"?"DOT_AND_NON_DOT":"NON_DOT",intake_required:true,metadata:meta,created_at:ts,updated_at:ts}).select("*").single();if(iq.error)throw iq.error;
  const session:any=await stripe.checkout.sessions.create({mode:"subscription",ui_mode:"custom",line_items:[{price:sp.price.id,quantity:1}],return_url:"https://non-dot.screenings4u.com/checkout.html?checkout=return&session_id={CHECKOUT_SESSION_ID}",client_reference_id:intentId,customer_email:S(b.email)||undefined,billing_address_collection:"auto",metadata:{checkout_intent_id:intentId,plan_id:p.id,plan_code:p.code,surface:"nondot_marketing",account_type:p.audience,portal_code:portal,purchased_program:p.audience==="ctpa"?"DOT_AND_NON_DOT":"NON_DOT",program:"NON_DOT"},subscription_data:{metadata:{checkout_intent_id:intentId,plan_id:p.id,plan_code:p.code,surface:"nondot_marketing",account_type:p.audience,portal_code:portal,purchased_program:p.audience==="ctpa"?"DOT_AND_NON_DOT":"NON_DOT",program:"NON_DOT"}}});
  const uq=await db.from("workforce_checkout_intents").update({stripe_checkout_session_id:session.id,status:"checkout_started",updated_at:new Date().toISOString()}).eq("id",intentId);if(uq.error)throw uq.error;
  return J({client_secret:session.client_secret,stripe_publishable_key:publishable,stripe_checkout_session_id:session.id,intent_id:intentId,reference:ref,plan:p});
 }catch(e){console.error("nondot-checkout",e);return J({error:e instanceof Error?e.message:String(e)},500)}
});