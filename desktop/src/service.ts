import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig, writeConfig, tokenUsageDir } from "../../src/config.js";
import { collectLocalUsage } from "../../src/file-scan.js";
import { readPricingCatalog } from "../../src/server-pricing-catalog.js";
import { aggregateEvents } from "../../src/usage-buckets.js";
import { acquireSyncLock, desktopAgentIsRunning, syncLocalUsage } from "../../src/collector.js";
import { setSqliteReader } from "../../src/sources/store-io.js";
import { setHttpClient } from "../../src/http-client.js";
import { renameDevice } from "../../src/api.js";
import { installAutoSync } from "../../src/scheduler.js";
import { main as cli } from "../../src/cli.js";
import { ApiError, apiRequest, checkedLoginUrl, createPkce, normalizeDesktopServer, setDesktopHttpClient } from "./auth.js";
import { readEmbeddedSqlite } from "./sqlite.js";
import { summarizeLocal } from "./summary.js";
import type { DesktopSecret, DesktopState, Settings } from "./contracts.js";

interface Init { version: string; collectorVersion: string; appData: string; executable: string; isolated: boolean; language: string; pid: number; background: boolean; headless: boolean }
const args = process.argv.slice(2);
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
function native(action: string, payload: unknown = {}): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, {resolve,reject}); output({type:"native",id,action,payload}); });
}
async function nativeFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  if (request.signal.aborted) throw request.signal.reason;
  const result = await native("http", {url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:request.method === "GET" || request.method === "HEAD" ? null : await request.text()});
  if (request.signal.aborted) throw request.signal.reason;
  return new Response(result.body || null,{status:result.status,headers:result.headers});
}
setSqliteReader(readEmbeddedSqlite);
let initial: Init;
let secret: DesktopSecret | null = null;
let loginController: AbortController | null = null;
let operation: Promise<unknown> | null = null;
let signingOut = false;
const timers: NodeJS.Timeout[] = [];
const state: DesktopState = {version:"0.2.0",collectorVersion:"",settings:{serverUrl:"https://tokenflow.renaissancemind.ai",deviceName:os.hostname(),launchAtLogin:true,paused:false,trayMetric:"cost",language:"en"},account:null,hasCollector:false,hasDashboard:false,busy:null,lastSyncAt:null,summary:null,login:null,error:null,notice:null,update:{status:"idle"}};
const settingsPath = () => path.join(initial.appData,"settings.json");
async function readOptional(file: string): Promise<string | null> {
  return fs.readFile(file,"utf8").catch((error: NodeJS.ErrnoException) => {if(error.code === "ENOENT")return null;throw error;});
}
async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+`.${process.pid}.tmp`;
  await fs.writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temporary,file);
}
function emit(): void { const now=new Date();output({type:"state",state:{...state,localDate:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`}}); }
async function marker(): Promise<void> {
  const file=path.join(tokenUsageDir(),"desktop-agent.json");
  if(state.hasCollector && !initial.headless) await atomicWrite(file,{pid:initial.pid,updatedAt:new Date().toISOString()});
  else if(!initial.headless)await fs.rm(file,{force:true});
}
async function mutateCollector(action: () => Promise<void>): Promise<void> {
  if(operation)await operation;
  const release=await acquireSyncLock();if(!release)throw new Error("The CLI is syncing. Wait for it to finish and try again.");
  try{await action();}finally{await release();}
}
async function setSession(token: string, expiresAt: string, open: boolean): Promise<void> {
  if(!token.startsWith("tu_sess_") || !Number.isFinite(Date.parse(expiresAt)))throw new Error("Server returned an invalid dashboard session");
  const me=await native("session",{server:state.settings.serverUrl,token,expiresAt,open});
  if(!me.user?.id)throw new Error("Dashboard did not return an account");
  state.account={id:me.user.id,name:me.user.name || null,email:me.user.email || null};state.hasDashboard=true;emit();
}
async function restoreSession(open=false): Promise<void> {
  if(!secret || signingOut)return;
  try{const result=await apiRequest(secret.serverUrl,"/api/desktop/session",{},secret.desktopToken);await setSession(result.session_token,result.session_expires_at,open);}
  catch(error){if(error instanceof ApiError && error.status === 401){state.account=null;state.hasDashboard=false;}state.error=errorText(error);emit();}
}
async function configureSystem(): Promise<void> {
  await native("autostart",{enabled:state.settings.launchAtLogin,isolated:initial.isolated});
  if(initial.isolated)return;
  const bin=path.join(tokenUsageDir(),"bin");await fs.mkdir(bin,{recursive:true});
  const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
  if(process.platform === "darwin"){
    const launch=path.join(bin,"tokenflow");
    await fs.writeFile(launch,`#!/bin/sh\nTOKENFLOW_HOME=${quote(tokenUsageDir())} ${quote(process.execPath)} --cli "$@"\n`,{mode:0o755});
    if(state.hasCollector)await installAutoSync(state.settings.serverUrl,os.homedir(),{env:{...process.env,TOKENFLOW_AUTO_SYNC_COMMAND:`TOKENFLOW_HOME=${quote(tokenUsageDir())} ${quote(initial.executable)} --collector-sync`}});
  }else if(process.platform === "win32"){
    await fs.writeFile(path.join(bin,"tokenflow.cmd"),`@echo off\r\n"${process.execPath}" --cli %*\r\n`);
  }
}
async function runJob(action: "scan" | "sync"): Promise<void> {
  if(state.busy || signingOut || (action === "sync" && !state.hasCollector))return;
  state.busy=action;state.error=null;emit();
  operation=(async()=>{
    const sync=action === "sync" ? await syncLocalUsage({home:process.env.TOKENFLOW_SCAN_HOME}) : null;
    if(action === "sync" && !sync)throw new Error("Another TokenFlow sync is running. Try again shortly.");
    const config=await readConfig();
    const collection=sync?.collection || await collectLocalUsage(process.env.TOKENFLOW_SCAN_HOME);
    const pricing=await readPricingCatalog(config?.serverUrl || state.settings.serverUrl);
    state.summary=await summarizeLocal(collection.events,[...pricing?.profiles || [],...collection.pricingProfiles],collection.sources,aggregateEvents);
    await atomicWrite(path.join(tokenUsageDir(),"desktop-summary.json"),state.summary);
    state.hasCollector=Boolean(config?.deviceToken || config?.apiToken);state.lastSyncAt=config?.lastSyncAt || null;state.notice=sync?.warning || null;await marker();
  })();
  try{await operation;}catch(error){state.error=errorText(error);}finally{operation=null;state.busy=null;emit();}
}
async function startLogin(provider: unknown): Promise<void> {
  if(provider !== "github" && provider !== "google")throw new Error("Choose GitHub or Google");
  if(state.busy || signingOut)throw new Error("Wait for the current operation to finish");
  const controller=new AbortController();loginController=controller;state.busy="login";state.error=null;emit();
  try{
    const pkce=createPkce();const config=await readConfig();const existing=config?.serverUrl === state.settings.serverUrl ? config.deviceToken : undefined;
    const flow=await apiRequest(state.settings.serverUrl,"/api/desktop/start",{provider,code_challenge:pkce.challenge,device_name:state.settings.deviceName,platform:process.platform},existing,controller.signal);
    if(typeof flow.code !== "string" || typeof flow.user_code !== "string" || !Number.isFinite(Date.parse(flow.expires_at)))throw new Error("Invalid desktop login request");
    state.login={code:flow.user_code,expiresAt:flow.expires_at};emit();await native("open_url",{url:checkedLoginUrl(flow.login_url,state.settings.serverUrl,provider)});
    void pollLogin(flow,pkce.verifier,existing,controller);
  }catch(error){if(loginController === controller){loginController=null;state.login=null;state.busy=null;}if(!controller.signal.aborted)throw error;}
}
async function pollLogin(flow:any,verifier:string,existing:string|undefined,controller:AbortController):Promise<void>{
  try{
    while(Date.now()<Date.parse(flow.expires_at)){
      await delay(Math.max(1,Math.min(Number(flow.poll_interval_seconds)||3,10))*1000,undefined,{signal:controller.signal});
      const result=await apiRequest(state.settings.serverUrl,"/api/desktop/poll",{code:flow.code,code_verifier:verifier},existing,controller.signal);
      if(result.status === "pending")continue;
      const token=result.reuse_device ? existing : result.device_token;
      if(result.status !== "approved" || typeof token !== "string" || !token.startsWith("tu_dev_") || typeof result.desktop_token !== "string" || !result.desktop_token.startsWith("tu_desktop_"))throw new Error("Invalid desktop authorization");
      const next:DesktopSecret={serverUrl:state.settings.serverUrl,desktopToken:result.desktop_token,deviceId:result.device_id};
      await native("secret_set",{name:"pending",value:JSON.stringify(next)});
      await mutateCollector(async()=>{
        const config=await readConfig();
        if(config?.serverUrl !== state.settings.serverUrl || (config.apiToken || config.deviceToken) !== token)await fs.rm(path.join(tokenUsageDir(),"sync-state.json"),{force:true});
        await writeConfig({...config,apiToken:undefined,serverUrl:state.settings.serverUrl,deviceToken:token,deviceId:result.device_id,deviceName:state.settings.deviceName,installedAt:config?.installedAt || new Date().toISOString()});
        await native("secret_commit");secret=next;
      });
      await setSession(result.session_token,result.session_expires_at,true);state.hasCollector=true;await marker();await configureSystem();return;
    }
    throw new Error("Login expired. Sign in again.");
  }catch(error){if(!controller.signal.aborted)state.error=errorText(error);}
  finally{if(loginController === controller){loginController=null;state.login=null;state.busy=null;emit();if(state.hasCollector && state.hasDashboard && !state.settings.paused)void runJob("sync");}}
}
async function saveSettings(value:unknown):Promise<void>{
  if(!value || typeof value !== "object")throw new Error("Invalid settings");
  if(state.busy || signingOut)throw new Error("Wait for the current operation to finish");
  const patch=value as Partial<Settings>;const next={...state.settings};
  if(patch.serverUrl !== undefined)next.serverUrl=normalizeDesktopServer(String(patch.serverUrl));
  if(patch.deviceName !== undefined){next.deviceName=String(patch.deviceName).trim();if(!next.deviceName || next.deviceName.length>120)throw new Error("Device name must be 1–120 characters");}
  for(const key of ["paused","launchAtLogin"] as const)if(patch[key] !== undefined){if(typeof patch[key] !== "boolean")throw new Error("Invalid preference");next[key]=patch[key]!;}
  if(patch.trayMetric !== undefined){if(!["cost","tokens","icon"].includes(patch.trayMetric))throw new Error("Invalid menu bar metric");next.trayMetric=patch.trayMetric;}
  if(patch.language !== undefined){if(!["en","zh"].includes(patch.language))throw new Error("Invalid language");next.language=patch.language;}
  if(next.serverUrl !== state.settings.serverUrl && (state.hasCollector || secret))throw new Error("Sign out before changing the server");
  await mutateCollector(async()=>{const config=await readConfig();if(config?.deviceToken && next.deviceName !== state.settings.deviceName)await renameDevice(next.serverUrl,config.deviceToken,next.deviceName);await writeConfig({...config,serverUrl:next.serverUrl,deviceName:next.deviceName,installedAt:config?.installedAt || new Date().toISOString()});});
  await atomicWrite(settingsPath(),next);state.settings=next;state.error=null;state.notice=null;await configureSystem();await marker();emit();
}
async function logout():Promise<void>{
  if(signingOut)return;signingOut=true;loginController?.abort();
  try{
    if(operation)await operation;
    if(secret){try{await apiRequest(secret.serverUrl,"/api/desktop/logout",{revoke_device:true},secret.desktopToken);}catch(error){if(!(error instanceof ApiError && error.status === 401))state.notice="Signed out locally. Remote authorization could not be revoked while offline.";}}
    await mutateCollector(async()=>{const config=await readConfig();if(config?.serverUrl === state.settings.serverUrl){const {apiToken,deviceToken,deviceId,...rest}=config;await writeConfig(rest);await fs.rm(path.join(tokenUsageDir(),"sync-state.json"),{force:true});}});
    await native("secret_clear");await native("clear_session");secret=null;state.hasCollector=false;state.hasDashboard=false;state.account=null;state.lastSyncAt=null;state.error=null;await marker();await native("show_local");
  }finally{signingOut=false;emit();}
}
async function initialize(value:Init):Promise<DesktopState>{
  initial=value;setHttpClient(nativeFetch);setDesktopHttpClient(nativeFetch);
  const config=await readConfig();const settings=await readOptional(settingsPath());
  state.version=value.version;state.collectorVersion=value.collectorVersion;
  state.settings={...state.settings,language:value.language.startsWith("zh")?"zh":"en",serverUrl:normalizeDesktopServer(config?.serverUrl || process.env.TOKENFLOW_SERVER_URL || state.settings.serverUrl),deviceName:config?.deviceName || state.settings.deviceName,...(settings?JSON.parse(settings):{})};state.settings.serverUrl=normalizeDesktopServer(state.settings.serverUrl);
  state.hasCollector=Boolean(config?.deviceToken || config?.apiToken);state.lastSyncAt=config?.lastSyncAt || null;
  const cache=await readOptional(path.join(tokenUsageDir(),"desktop-summary.json"));if(cache)state.summary=JSON.parse(cache);
  if(value.headless){if(await desktopAgentIsRunning())return state;await runJob("sync");if(state.error)throw new Error(state.error);return state;}
  const staged=await native("secret_get",{name:"pending"});
  if(staged){const next=JSON.parse(staged);if(next.deviceId === config?.deviceId && next.serverUrl === config?.serverUrl)await native("secret_commit");else await native("secret_delete",{name:"pending"});}
  const stored=await native("secret_get",{name:"authorization"});if(stored){secret=JSON.parse(stored);if(secret?.serverUrl !== state.settings.serverUrl)throw new Error("Stored authorization belongs to another server");}
  await configureSystem();await marker();emit();
  timers.push(setInterval(()=>{void marker().catch(error=>{state.error=errorText(error);emit();});},30_000));
  timers.push(setInterval(()=>{if(!state.settings.paused)void runJob(state.hasCollector?"sync":"scan");},600_000));
  timers.push(setInterval(()=>void restoreSession(),86400_000));
  void restoreSession(!value.background);void runJob(state.hasCollector && !state.settings.paused?"sync":"scan");return state;
}
async function shutdown():Promise<void>{loginController?.abort();timers.forEach(clearInterval);if(operation)await operation;if(!initial?.headless)await fs.rm(path.join(tokenUsageDir(),"desktop-agent.json"),{force:true});}
const handlers:Record<string,(value:any)=>unknown>={init:initialize,state:()=>state,login:startLogin,"cancel-login":()=>{loginController?.abort();},settings:saveSettings,scan:()=>runJob("scan"),sync:()=>runJob("sync"),dashboard:()=>state.hasDashboard?native("show_dashboard"):secret?restoreSession(true):native("show_local"),"dashboard-expired":async()=>{state.hasDashboard=false;state.account=null;state.error="Dashboard session expired. Open the dashboard to reconnect.";await native("show_local");emit();},"open-settings":()=>native("show_local"),logout,shutdown,update:async(action:string)=>{if(action==="check" || action==="download"){state.update={status:action==="check"?"checking":"downloading"};emit();}try{const update=await native("update",{action});state.update=update;emit();}catch(error){state.update={status:"error",message:errorText(error)};throw error;}}};
async function entry():Promise<void>{
  if(args[0] === "--cli"){await cli(args.slice(1));return;}
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  lines.on("line",line=>{
    const message=JSON.parse(line);
    if(message.type === "native_reply"){const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);if(message.error)waiter.reject(new Error(message.error));else waiter.resolve(message.result);}return;}
    if(message.type !== "call")return;
    const handler=handlers[message.action];
    Promise.resolve().then(()=>{if(!handler)throw new Error("Unknown desktop action");return handler(message.payload);}).then(result=>{emit();output({type:"reply",id:message.id,result:result ?? null});}).catch(error=>{state.error=errorText(error);emit();output({type:"reply",id:message.id,error:state.error});});
  });
  lines.on("close",()=>{void shutdown().finally(()=>process.exit(0));});output({type:"ready"});
}
void entry().catch(error=>{process.stderr.write(errorText(error)+"\n");process.exitCode=1;});
