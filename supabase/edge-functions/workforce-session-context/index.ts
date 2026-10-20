import {createClient} from "npm:@supabase/supabase-js@2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const ROLES=new Set(["ctpa","employer","employee","driver","owner_operator"]);
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!anon||!service)return reply({error:"Configuration unavailable"},500);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"").trim();if(!token)return reply({error:"Authentication required"},401);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)return reply({error:"Authentication required"},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json().catch(()=>({}));
  const requested=String(body.requested_portal||"").toLowerCase().replaceAll("-","_");
  if(!ROLES.has(requested))return reply({error:"Invalid portal",has_access:false},400);
  const wanted=String(body.membership_id||"").trim();
  if(wanted&&!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(wanted))return reply({error:"Invalid membership",has_access:false},400);
  const memberships=await db.from("workforce_memberships").select("id,tenant_id,organization_id,role_id,is_primary,status").eq("user_id",user.id).eq("status","active");
  if(memberships.error)throw memberships.error;
  const eligible=[];
  for(const member of memberships.data||[]){
   if(wanted&&member.id!==wanted)continue;
   const code=requested==="owner_operator"?"owner_operator":requested+"_workforce";
   const [personal,org,role]=await Promise.all([
    db.from("workforce_portal_user_access").select("enabled").eq("user_id",user.id).eq("organization_id",member.organization_id).eq("portal_code",code).maybeSingle(),
    db.from("workforce_portal_access").select("enabled").eq("organization_id",member.organization_id).eq("portal_code",code).maybeSingle(),
    db.from("workforce_roles").select("code").eq("id",member.role_id).maybeSingle()
   ]);
   for(const q of [personal,org,role])if(q.error)throw q.error;
   if(personal.data?.enabled===false)continue;
   if(personal.data?.enabled!==true&&org.data?.enabled!==true)continue;
   if(requested==="ctpa"||requested==="employer"){
    const subject=requested==="ctpa"?"workforce_ctpas":"workforce_employers",key=requested==="ctpa"?"ctpa_id":"employer_id";
    const entity=await db.from(subject).select("id").eq("organization_id",member.organization_id).eq("status","active").maybeSingle();
    if(entity.error)throw entity.error;if(!entity.data)continue;
    const subs=await db.from("workforce_subscriptions").select("id,status,purchased_program,plan_id").eq(key,entity.data.id).in("status",["active","trial","trialing"]);
    if(subs.error)throw subs.error;
    const active=(subs.data||[]).find((s:any)=>requested==="ctpa"?s.purchased_program==="DOT_AND_NON_DOT":["DOT","NON_DOT"].includes(s.purchased_program));
    if(!active)continue;
    eligible.push({portal:requested,membership:{...member,role_code:role.data?.code||null},subscription:active});
   }else{
    // Employee, Driver and Owner-Operator require separately verified provisioning.
    // Do not infer those entitlements from a general employer subscription.
    continue;
   }
  }
  const selected=eligible.length===1?eligible[0]:null;
  return reply({has_access:eligible.length>0,portal:selected?.portal||null,membership:selected?.membership||null,subscription:selected?.subscription||null,requires_workspace_selection:eligible.length>1,workspaces:eligible,user:{id:user.id,email:user.email}});
 }catch(e){console.error("workforce-session-context",e);return reply({error:"Session validation failed",has_access:false},500)}
});
