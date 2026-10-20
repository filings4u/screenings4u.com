import { createClient } from "npm:@supabase/supabase-js@2";
const origin="https://portal.screenings4u.com";
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const aliases:Record<string,string>={faa_employer_dot:"dot_faa_employer",fra_employer_dot:"dot_fra_employer",fta_employer_dot:"dot_fta_employer",phmsa_employer_dot:"dot_phmsa_employer",uscg_employer_dot:"dot_uscg_employer",ctpa_dot:"dot_ctpa",ctpa_employer_dot:"dot_ctpa_employer",ctpa_employee_dot:"dot_ctpa_employee",ctpa_driver_dot:"dot_ctpa_driver",faa_dot:"dot_faa_employer",fmcsa_dot:"dot_fmcsa_employer",fra_dot:"dot_fra_employer",fta_dot:"dot_fta_employer",phmsa_dot:"dot_phmsa_employer",uscg_dot:"dot_uscg_employer",owner_operator:"dot_owner_operator",ctpa_employer_workforce:"nondot_ctpa_employer",ctpa_employee_workforce:"nondot_ctpa_employee",ctpa_driver_workforce:"nondot_ctpa_driver",ctpa_workforce:"nondot_ctpa",employer_workforce:"nondot_employer",nondot_driver:"nondot_ctpa_driver",lms:"training_lms"};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 try {
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token)return respond({error:"Sign in required"},401);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const pub=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 const auth=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user)return respond({error:"Invalid session"},401);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const [om,wm,ua,catalog,plans,specialLms,specialCustomer]=await Promise.all([
 db.from("organization_memberships").select("id,organization_id").eq("user_id",user.id).eq("status","active"),
 db.from("workforce_memberships").select("id,organization_id").eq("user_id",user.id).eq("status","active"),
 db.from("workforce_portal_user_access").select("organization_id,portal_code,enabled").eq("user_id",user.id),
 db.from("enterprise_portals").select("id,portal_code,name,hostname,portal_type").eq("active",true),
 db.from("plans").select("id,code,name,active").in("code",["dot_ctpa_essential","dot_ctpa_professional","dot_ctpa_enterprise"]),
 db.from("lms_enrollments").select("id").eq("user_id",user.id).limit(1),
 db.from("testing_customer_portal_access").select("status").eq("user_id",user.id).limit(1)
 ]);
 for(const x of [om,wm,ua,catalog,plans,specialLms,specialCustomer])if(x.error)throw x.error;
 const ids=[...new Set([...(om.data||[]),...(wm.data||[]),...(ua.data||[])].map(r=>r.organization_id).filter(Boolean))];
 const activeWorkforceOrgs=new Set((wm.data||[]).map(m=>m.organization_id));
 const activeDotOrgs=new Set((om.data||[]).map(m=>m.organization_id));
 const access=[...(ua.data||[]).filter(r=>r.enabled===true&&activeWorkforceOrgs.has(r.organization_id)).map(r=>({organization_id:r.organization_id,portal_code:r.portal_code}))];
 const deniedWorkforce=new Set((ua.data||[]).filter(r=>r.enabled===false).map(r=>r.organization_id+"|"+r.portal_code));
 if(ids.length){
 const [a,b]=await Promise.all([
 db.from("organization_portal_access").select("organization_id,portal_code").in("organization_id",ids).eq("enabled",true),
 db.from("workforce_portal_access").select("organization_id,portal_code").in("organization_id",ids).eq("enabled",true)
 ]);
 if(a.error)throw a.error;if(b.error)throw b.error;
 access.push(...(a.data||[]).filter(r=>activeDotOrgs.has(r.organization_id)&&!r.portal_code.endsWith("_workforce")),...(b.data||[]).filter(r=>activeWorkforceOrgs.has(r.organization_id)&&r.portal_code.endsWith("_workforce")&&!deniedWorkforce.has(r.organization_id+"|"+r.portal_code)));
 }
 const codes=[...new Set(access.map(x=>aliases[x.portal_code]||x.portal_code))];
 const orgs=ids.length?await db.from("organizations").select("id,legal_name,dba_name").in("id",ids):{data:[],error:null};
 if(catalog.error)throw catalog.error;if(orgs.error)throw orgs.error;
 const organizations=new Map((orgs.data||[]).map(o=>[o.id,o.dba_name||o.legal_name]));
 const catalogMap=new Map((catalog.data||[]).map(p=>[p.portal_code,p]));
 const seen=new Set<string>();
 const portals:any[]=[];
 // Subscription-backed selector rows must represent real subscriptions, not a collapsed organization/portal.
 const dotEmployers=ids.length?await db.from("employers").select("id,organization_id").in("organization_id",ids):{data:[],error:null};
 const dotCtpas=ids.length?await db.from("ctpas").select("id,organization_id").in("organization_id",ids):{data:[],error:null};
 const wfEmployers=ids.length?await db.from("workforce_employers").select("id,organization_id").in("organization_id",ids):{data:[],error:null};
 const wfCtpas=ids.length?await db.from("workforce_ctpas").select("id,organization_id").in("organization_id",ids):{data:[],error:null};
 for(const q of [dotEmployers,dotCtpas,wfEmployers,wfCtpas])if(q.error)throw q.error;
 const orgDotEmployer=new Map((dotEmployers.data||[]).map(x=>[x.id,x.organization_id]));
 const orgDotCtpa=new Map((dotCtpas.data||[]).map(x=>[x.id,x.organization_id]));
 const orgWfEmployer=new Map((wfEmployers.data||[]).map(x=>[x.id,x.organization_id]));
 const orgWfCtpa=new Map((wfCtpas.data||[]).map(x=>[x.id,x.organization_id]));
 const dotSubs=await db.from("subscriptions").select("id,employer_id,ctpa_id,plan_id,status").in("status",["active","trial"]);
 const wfSubs=await db.from("workforce_subscriptions").select("id,employer_id,ctpa_id,plan_id,status").in("status",["active","trial"]);
 const allDotPlans=await db.from("plans").select("id,name,code,active");
 const allWfPlans=await db.from("workforce_plans").select("id,name,code,active");
 for(const q of [dotSubs,wfSubs,allDotPlans,allWfPlans])if(q.error)throw q.error;
 const dotPlanNames=new Map((allDotPlans.data||[]).filter(x=>x.active).map(x=>[x.id,x.name]));
 const wfPlanNames=new Map((allWfPlans.data||[]).filter(x=>x.active).map(x=>[x.id,x.name]));
 for(const grant of access){
 if(deniedWorkforce.has(grant.organization_id+"|"+grant.portal_code))continue;
 if(grant.portal_code==='ctpa_dot'||grant.portal_code==='ctpa_employer_dot')continue;
 const code=aliases[grant.portal_code]||grant.portal_code;
 const p=catalogMap.get(code);if(!p)continue;
 const host=String(p.hostname||"").toLowerCase();
 if(!/^([a-z0-9-]+\.)*screenings4u\.com$/.test(host))continue;
 const unique=String(grant.organization_id||"")+"|"+code;
 if(seen.has(unique))continue;seen.add(unique);
 const workforce=grant.portal_code.endsWith("_workforce");
 const membership=((workforce?wm.data:om.data)||[]).find(m=>m.organization_id===grant.organization_id)?.id||null;
 if(!membership)continue;
 const selectedCtpa=(wfCtpas.data||[]).find(x=>x.organization_id===grant.organization_id);
 const selectedEmployer=(dotEmployers.data||[]).find(x=>x.organization_id===grant.organization_id);
 const workspaceFields=grant.portal_code==="ctpa_workforce"
  ?{ctpa_id:selectedCtpa?.id||null,organization_id:grant.organization_id}
  :grant.portal_code==="employer_dot"
  ?{employer_id:selectedEmployer?.id||null,organization_id:grant.organization_id}
  :{organization_id:grant.organization_id};
 const portalSubs=workforce?(wfSubs.data||[]).filter(x=>(orgWfEmployer.get(x.employer_id)||orgWfCtpa.get(x.ctpa_id))===grant.organization_id):(dotSubs.data||[]).filter(x=>(orgDotEmployer.get(x.employer_id)||orgDotCtpa.get(x.ctpa_id))===grant.organization_id);
 const names=workforce?wfPlanNames:dotPlanNames;
 const relevantPlan=(planCode:string)=>{
   if(grant.portal_code==="owner_operator")return planCode.startsWith("owner_operator_");
   if(grant.portal_code==="ctpa_workforce")return planCode.startsWith("workforce_ctpa_");
   if(grant.portal_code==="employer_workforce")return planCode.startsWith("workforce_employer_");
   if(grant.portal_code==="employer_dot")return planCode.startsWith("dot_employer_")||planCode.startsWith("dot_fmcsa_");
   const agency=grant.portal_code.match(/^(faa|fmcsa|fra|fta|phmsa|uscg)(?:_employer)?_dot$/);
   if(agency)return planCode.startsWith("dot_"+agency[1]+"_");
   return true;
 };
 const planCodes=new Map((workforce?allWfPlans.data:allDotPlans.data||[]).map(x=>[x.id,x.code]));
 const rows=portalSubs.filter(x=>names.has(x.plan_id)&&relevantPlan(String(planCodes.get(x.plan_id)||"")));
 // Do not present a fake Enterprise subscription when an organization only has access but no paid/trial record.
 if(!rows.length){
   portals.push({id:unique,title:p.name,organization:organizations.get(grant.organization_id)||"Your organization",plan:"Organization access",portal_type:p.portal_type,launch_url:"https://"+host+"/",membership_id:membership,portal_code:grant.portal_code,...workspaceFields});
 }else for(const sub of rows){
   portals.push({id:unique+"|"+sub.id,title:p.name,organization:organizations.get(grant.organization_id)||"Your organization",plan:names.get(sub.plan_id),portal_type:p.portal_type,launch_url:"https://"+host+"/",membership_id:membership,subscription_id:sub.id,portal_code:grant.portal_code,...workspaceFields});
 }
 }


// Sponsored DOT employer choices use their actual membership and active purchased employer subscription.
const sponsorGrants=access.filter(x=>x.portal_code==="ctpa_employer_dot");
const sponsorOrgIds=[...new Set(sponsorGrants.map(x=>x.organization_id).filter(Boolean))].filter(id=>(om.data||[]).some(m=>m.organization_id===id));
if(sponsorOrgIds.length){
 const [eq,sp]=await Promise.all([
  db.from("employers").select("id,organization_id,ctpa_id").in("organization_id",sponsorOrgIds).eq("status","active").not("ctpa_id","is",null),
  db.from("subscriptions").select("id,employer_id,plan_id,status,created_at").in("status",["active","trial","trialing"]).order("created_at",{ascending:false})
 ]);
 if(eq.error||sp.error)throw eq.error||sp.error;
 const employerMap=new Map((eq.data||[]).map(e=>[e.id,e]));
 const sponsored=(sp.data||[]).filter(x=>employerMap.has(x.employer_id));
 if(sponsored.length){
   const planIds=[...new Set(sponsored.map(x=>x.plan_id).filter(Boolean))];
   const pq=await db.from("plans").select("id,code,name,active").in("id",planIds);
   if(pq.error)throw pq.error;
   const planMap=new Map((pq.data||[]).filter(x=>x.active!==false&&x.code==="dot_employer_ctpa_sponsored").map(x=>[x.id,x]));
   for(const sub of sponsored){
     const employer=employerMap.get(sub.employer_id),plan=planMap.get(sub.plan_id);
     if(!employer||!plan)continue;
     const membership=(om.data||[]).find(m=>m.organization_id===employer.organization_id);
     if(!membership)continue;
     portals.push({id:"sponsored:"+employer.id+":"+sub.id,title:"DOT C/TPA Sponsored Employer",organization:organizations.get(employer.organization_id)||"Sponsored Employer",plan:plan.name,portal_type:"DOT Sponsored Employer",launch_url:"https://ctpa-employer-dot.screenings4u.com/",membership_id:membership.id,subscription_id:sub.id});
   }
 }
}

 // C/TPA DOT subscriptions are distinct selectable workspaces, not one generic portal card.
 const ctpaOrgIds=[...new Set((om.data||[]).map(x=>x.organization_id).filter(Boolean))];
 if(ctpaOrgIds.length){
   const [cq,aq]=await Promise.all([
     db.from("ctpas").select("id,organization_id").in("organization_id",ctpaOrgIds).eq("status","active"),
     db.from("organization_portal_access").select("organization_id,enabled").in("organization_id",ctpaOrgIds).eq("portal_code","ctpa_dot").eq("enabled",true)
   ]);
   if(cq.error||aq.error)throw cq.error||aq.error;
   const allowedOrgs=new Set((aq.data||[]).map(x=>x.organization_id));
   const ctpaRows=(cq.data||[]).filter(x=>allowedOrgs.has(x.organization_id));
   if(ctpaRows.length){
     const sq=await db.from("subscriptions").select("id,ctpa_id,plan_id,status,created_at").in("ctpa_id",ctpaRows.map(x=>x.id)).order("created_at",{ascending:false});
     if(sq.error)throw sq.error;
     const planMap=new Map((plans.data||[]).filter(x=>x.active!==false).map(x=>[x.id,x]));
     for(const ctpa of ctpaRows){
       for(const sub of sq.data||[]){
         if(sub.ctpa_id!==ctpa.id || !["active","trial","trialing"].includes(sub.status))continue;
         const plan=planMap.get(sub.plan_id);if(!plan)continue;
         portals.push({id:"ctpa:"+ctpa.id+":"+sub.id,title:"DOT C/TPA — "+plan.name,organization:organizations.get(ctpa.organization_id)||"C/TPA Account",plan:plan.name,portal_type:"DOT C/TPA",launch_url:"https://ctpa-dot.screenings4u.com/",ctpa_id:ctpa.id,subscription_id:sub.id});
       }
     }
   }
 }


// Employee-owned sponsored accounts; no organization membership is required.
const employeeQuery=await db.from("employees").select("id,employer_id").eq("auth_user_id",user.id).eq("employment_status","active").is("archived_at",null);
if(employeeQuery.error)throw employeeQuery.error;
if(employeeQuery.data?.length){
 const employerIds=[...new Set(employeeQuery.data.map(e=>e.employer_id).filter(Boolean))];
 if(employerIds.length){
   const employers=await db.from("employers").select("id,organization_id,ctpa_id").in("id",employerIds).eq("status","active").not("ctpa_id","is",null);
   if(employers.error)throw employers.error;
   const sponsored=employers.data||[];
   if(sponsored.length){
     const [grants,subs,ps]=await Promise.all([
       db.from("organization_portal_access").select("organization_id").in("organization_id",sponsored.map(e=>e.organization_id)).eq("portal_code","ctpa_employer_dot").eq("enabled",true),
       db.from("subscriptions").select("id,employer_id,plan_id,status").in("employer_id",sponsored.map(e=>e.id)).in("status",["active","trial","trialing"]),
       db.from("plans").select("id,code,active").eq("code","dot_employer_ctpa_sponsored").eq("active",true)
     ]);
     if(grants.error||subs.error||ps.error)throw grants.error||subs.error||ps.error;
     const permittedOrgs=new Set((grants.data||[]).map(g=>g.organization_id));
     const permittedPlans=new Set((ps.data||[]).map(p=>p.id));
     const orgNames=await db.from("organizations").select("id,legal_name,dba_name").in("id",sponsored.map(e=>e.organization_id));
     if(orgNames.error)throw orgNames.error;
     const names=new Map((orgNames.data||[]).map(o=>[o.id,o.dba_name||o.legal_name]));
     for(const employee of employeeQuery.data){
       const employer=sponsored.find(e=>e.id===employee.employer_id);
       if(!employer||!permittedOrgs.has(employer.organization_id))continue;
       const sub=(subs.data||[]).find(x=>x.employer_id===employer.id&&permittedPlans.has(x.plan_id));
       if(!sub)continue;
       portals.push({id:"sponsored-employee:"+employee.id,title:"DOT C/TPA Sponsored Employee",organization:names.get(employer.organization_id)||"Sponsored employer",plan:"Sponsored employee access",portal_type:"DOT Employee",launch_url:"https://ctpa-employee-dot.screenings4u.com/",employee_id:employee.id});
     }
   }
 }
}

// Personally assigned C/TPA DOT drivers, including explicitly provisioned QA drivers.
const driverAssignments=await db.from("account_type_assignments").select("id,employee_id,employer_id,ctpa_id,source,account_types!inner(code)").eq("user_id",user.id).eq("status","active").is("archived_at",null).eq("account_types.code","dot_ctpa_driver");
if(driverAssignments.error)throw driverAssignments.error;
for(const assignment of driverAssignments.data||[]){
 if(!assignment.employee_id||!assignment.ctpa_id)continue;
 const employee=await db.from("employees").select("id,employer_id,auth_user_id,cdl_number").eq("id",assignment.employee_id).eq("auth_user_id",user.id).eq("employment_status","active").is("archived_at",null).maybeSingle();
 if(employee.error)throw employee.error;
 if(!employee.data||(!String(employee.data.cdl_number||"").trim()&&assignment.source!=="screenings4u_test_driver"))continue;
 const employer=await db.from("employers").select("id,ctpa_id,organization_id,status").eq("id",employee.data.employer_id).eq("status","active").maybeSingle();
 if(employer.error)throw employer.error;
 if(!employer.data||employer.data.ctpa_id!==assignment.ctpa_id)continue;
 const ctpa=await db.from("ctpas").select("id,status").eq("id",assignment.ctpa_id).eq("status","active").maybeSingle();
 if(ctpa.error)throw ctpa.error;
 if(!ctpa.data)continue;
 if(!seen.has("driver:"+assignment.employee_id)){
  seen.add("driver:"+assignment.employee_id);
  portals.push({id:"sponsored-driver:"+assignment.employee_id,title:"DOT C/TPA Sponsored Driver",organization:"Sponsored driver account",plan:"Sponsored driver access",portal_type:"DOT Driver",launch_url:"https://ctpa-driver-dot.screenings4u.com/",employee_id:assignment.employee_id});
 }
}
 const contractorAssignments=await db.from("account_type_assignments").select("id,account_type_id,ctpa_id,employer_id,account_types!inner(code)").eq("user_id",user.id).eq("status","active").is("archived_at",null).in("account_types.code",["dot_ctpa_contractor","dot_employer_contractor"]);if(contractorAssignments.error)throw contractorAssignments.error;
 for(const a of contractorAssignments.data||[]){const type=String((a as any).account_types?.code||"");const code=type==="dot_ctpa_contractor"?"ctpa_contractor_dot":"direct_contractor_dot";if(!a.ctpa_id&&!a.employer_id)continue;portals.push({id:"contractor:"+a.id,title:"Independent Contractor",organization:"Assigned contractor account",plan:type==="dot_ctpa_contractor"?"C/TPA Sponsored":"Direct Employer",portal_type:"DOT Contractor",launch_url:"https://independent-contractor.screenings4u.com/",portal_code:code,assignment_id:a.id});}
 const icAccess=await db.from("ic_portal_access").select("enabled").eq("user_id",user.id).eq("enabled",true).maybeSingle();if(icAccess.error)throw icAccess.error;if(icAccess.data&&!portals.some((row:any)=>row.launch_url==="https://independent-contractor.screenings4u.com/"))portals.push({id:"ic:"+user.id,title:"Independent Contractor",organization:"screenings4u IC Network",plan:"Independent Contractor",portal_type:"Independent Contractor",launch_url:"https://independent-contractor.screenings4u.com/",portal_code:"independent_contractor"});
 const special=[specialLms,specialCustomer];
 for(const [code,ok] of [["training_lms",(special[0].data||[]).length>0],["testing_customer",(special[1].data||[]).some(v=>v.status==="active")]] as const){
 if(!ok||codes.includes(code))continue;const p=catalogMap.get(code);if(!p)continue;
 const host=String(p.hostname||"");if(!/^([a-z0-9-]+\.)*screenings4u\.com$/.test(host))continue;
 portals.push({id:code,title:p.name,organization:"Your account",plan:"Enterprise",portal_type:p.portal_type,launch_url:"https://"+host+"/"});
 }

 for(const grant of ua.data||[]){
 if(grant.portal_code==="driver_workforce"&&grant.enabled===true&&activeWorkforceOrgs.has(grant.organization_id)){
  portals.push({id:"workforce-driver:"+grant.organization_id,title:"NON-DOT Direct Driver",organization:organizations.get(grant.organization_id)||"Assigned driver account",plan:"Driver access",portal_type:"NON-DOT Individual",launch_url:"https://driver-non-dot.screenings4u.com/",portal_code:"driver_workforce"});
 }
 }
 const individual=await db.from("dot_individual_portal_access").select("portal_code,employee_id").eq("user_id",user.id).eq("enabled",true);
 if(individual.error)throw individual.error;
 const individualHosts:Record<string,string>={faa_employee_dot:"faa-employee-dot.screenings4u.com",fra_employee_dot:"fra-employee-dot.screenings4u.com",fta_employee_dot:"fta-employee-dot.screenings4u.com",phmsa_employee_dot:"phmsa-employee-dot.screenings4u.com",uscg_employee_dot:"uscg-employee-dot.screenings4u.com",employee_dot:"fmcsa-employee-dot.screenings4u.com",driver_dot:"fmcsa-driver-dot.screenings4u.com"};
 for(const grant of individual.data||[]){
 const host=individualHosts[grant.portal_code];if(!host)continue;
 portals.push({id:"individual:"+grant.portal_code+":"+grant.employee_id,title:grant.portal_code.replaceAll("_"," ").toUpperCase(),organization:"Assigned employee account",plan:"Employee access",portal_type:"DOT Individual",launch_url:"https://"+host+"/",portal_code:grant.portal_code,employee_id:grant.employee_id});
 }
 // Development directory: show the intended portal family to its named QA account.
 // These entries do not grant subscriptions, handoff tokens or backend permissions.
 const qaManagers=user.email?.toLowerCase()==="aerving1@gmail.com";
 const qaIndividuals=user.email?.toLowerCase()==="screenings4u@gmail.com";
 if(qaManagers||qaIndividuals){
  const family=(p:any)=>{
   const code=String(p.portal_code||"");
   if(!code.startsWith("dot_")||["dot_public","dot_management"].includes(code))return false;
   return qaManagers?(/ctpa$|ctpa_employer$|_employer$/.test(code)):(/_employee$|_driver$/.test(code));
  };
  const existingHosts=new Set(portals.map((p:any)=>{try{return new URL(p.launch_url).hostname}catch{return ""}}));
  for(const p of catalog.data||[]){
   if(!family(p)||!p.active&&p.active!==undefined)continue;
   const host=String(p.hostname||"").toLowerCase();
   if(!/^([a-z0-9-]+\.)*screenings4u\.com$/.test(host)||existingHosts.has(host))continue;
   existingHosts.add(host);
   portals.push({id:"qa-setup:"+p.portal_code,title:p.name,organization:"Portal development workspace",plan:"Setup / testing",portal_type:qaManagers?"DOT Management":"DOT Individual",launch_url:"https://"+host+"/",setup_only:true});
  }
 }
 return respond({portals});
 }catch(e){console.error("central-selector",e);return respond({error:"Unable to load authorized portals"},500)}
});