import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
const call = (action: string, payload: unknown = null) => invoke("bridge", { action, payload }).catch(error => {throw error instanceof Error ? error : new Error(String(error));});
Object.defineProperty(window,"tokenflow",{value:Object.freeze({
  getState:()=>call("state"),login:(provider:string)=>call("login",provider),cancelLogin:()=>call("cancel-login"),
  saveSettings:(settings:unknown)=>call("settings",settings),sync:()=>call("sync"),scan:()=>call("scan"),
  dashboard:()=>call("dashboard"),logout:()=>call("logout"),openSettings:()=>call("open-settings"),
  checkUpdate:()=>call("update","check"),downloadUpdate:()=>call("update","download"),installUpdate:()=>call("update","install"),
  onState:(callback:(value:unknown)=>void)=>{let stop:(()=>void)|undefined;void listen("tokenflow:changed",event=>callback(event.payload)).then(value=>{stop=value;});return()=>stop?.();},
})});

void listen<string>("tokenflow:failure", event => { const target=document.getElementById("error"); if(target){target.textContent=event.payload;target.hidden=false;} });
