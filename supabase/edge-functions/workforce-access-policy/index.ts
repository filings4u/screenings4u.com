import {createClient} from "npm:@supabase/supabase-js@2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const DOT_AGENCIES=new Set(["FMCSA","FAA","FRA","FTA","PHMSA","USCG"]);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!anon||!service)return out({error:"Configuration unavailable"},500);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return out({error:"Authentication required"},401);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return out({error:"Authentication required"},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const b=await req.json().catch(()=>({})),org=String(b.organization_id||"");
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(org))return out({error:"Valid organization_id required"},400);
  const [member,personal,organization,emp,ctpa]=await Promise.all([
   db.from("workforce_memberships").select("id").eq("organization_id",org).eq("user_id",user.id).eq("status","active").limit(1),
   db.from("workforce_portal_user_access").select("portal_code,enabled").eq("organization_id",org).eq("user_id",user.id).eq("enabled",true),
   db.from("workforce_portal_access").select("portal_code,enabled").eq("organization_id",org).eq("enabled",true),
   db.from("workforce_employers").select("id,workforce_classification,applicable_dot_agency").eq("organization_id",org).eq("status","active"),
   db.from("workforce_ctpas").select("id").eq("organization_id",org).eq("status","active")
  ]);
  for(const q of [member,personal,organization,emp,ctpa])if(q.error)throw q.error;
  if(!member.data?.length)return out({error:"Organization access denied"},403);
  const allowed=new Set((personal.data||[]).map((v:any)=>v.portal_code).filter((code:string)=>(organization.data||[]).some((a:any)=>a.portal_code===code)));
  const subjects=[...(emp.data||[]).map((e:any)=>({id:e.id,kind:"employer",classification:e.workforce_classification,agency:e.applicable_dot_agency})),...(ctpa.data||[]).map((c:any)=>({id:c.id,kind:"ctpa"}))];
  const matches:any[]=[];
  for(const subject of subjects){
    const q=await db.from("workforce_subscriptions").select("id,status,purchased_program,employer_id,ctpa_id").eq(subject.kind==="employer"?"employer_id":"ctpa_id",subject.id).in("status",["active","trial","trialing"]);
    if(q.error)throw q.error;
    for(const sub of q.data||[]){
      // No legacy entitlement inference: null requires a separate audited backfill.
      const value=String(sub.purchased_program||"");
      const plausible=subject.kind==="ctpa"?value==="DOT_AND_NON_DOT":["DOT","NON_DOT"].includes(value);
      if(!plausible)continue;
      if(subject.kind==="employer"&&value!==subject.classification)continue;
      if(value==="DOT"&&!DOT_AGENCIES.has(String(subject.agency||"").toUpperCase()))continue;
      const portal=subject.kind==="ctpa"?"ctpa_workforce":"employer_workforce";
      if(!allowed.has(portal))continue;
      matches.push({subscription_id:sub.id,program:value,role:subject.kind,agency:value==="DOT"?String(subject.agency).toUpperCase():null});
    }
  }
  const effective=[...new Set(matches.flatMap(m=>m.program==="DOT_AND_NON_DOT"||m.program==="DOT"?["DOT","NON_DOT"]:["NON_DOT"]))];
  return out({organization_id:org,access_granted:matches.length>0,effective_programs:effective,effective_portals:[...new Set(matches.map(m=>m.role==="ctpa"?"ctpa_workforce":"employer_workforce"))],subscriptions:matches,requires_onboarding:matches.length===0});
 }catch(e){console.error("workforce-access-policy",e);return out({error:"Access evaluation failed"},500)}
});