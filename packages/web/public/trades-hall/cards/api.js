const KEY='trades-hall-cards-session-v1';
let memoryToken;
export function respondentToken(){
 if(memoryToken)return memoryToken;
 try{const saved=localStorage.getItem(KEY);if(saved&&/^[A-Za-z0-9_-]{43}$/.test(saved)){memoryToken=saved;return saved;}}catch{}
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 memoryToken=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 try{localStorage.setItem(KEY,memoryToken);}catch{}
 return memoryToken;
}
export class ReviewError extends Error{constructor(message,code,status){super(message);this.code=code;this.status=status;}}
export async function requestReview({token=respondentToken(),body,all=false}={}){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch('/api/card-review'+(all?'?view=all':''),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
  let data;try{data=await response.json();}catch{throw new ReviewError('The feedback service returned an unreadable response. Please try again.','SERVICE_ERROR',response.status);}
  if(!response.ok)throw new ReviewError(data.error||'Your feedback could not be saved. Please try again.',data.code,response.status);
  return data;
 }catch(error){if(error.name==='AbortError')throw new ReviewError('The connection timed out. Your draft is still here; please try again.','TIMEOUT',0);if(error instanceof ReviewError)throw error;throw new ReviewError('Could not reach the feedback service. Your draft is still here; please try again.','NETWORK_ERROR',0);}finally{clearTimeout(timer);}
}
