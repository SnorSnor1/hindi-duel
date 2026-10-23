import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudProgress} from './cloud-progress.js';
import {makeProgressProfile,restoreProgressProfile} from './progress-sync.js';

const snapshot=value=>({val:()=>structuredClone(value)});
const fresh=()=>({attempts:{maaike:{phase1:[],phase2:[],phase3:[]}},scores:{maaike:[]},mistakes:{maaike:{}},dailyPractice:{},wordOverrides:{}});
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function service(){
  const data=new Map(),listeners=new Map();let chain=Promise.resolve();
  const server={data,paths:[],online:true,fail:false};
  server.ref=path=>({
    get:async()=>{if(server.fail)throw {code:'permission-denied'};return snapshot(data.get(path) || null);},
    on(type,callback,error){if(path==='.info/connected'){server.connectivity ||= new Set();server.connectivity.add(callback);callback(snapshot(server.online));return;}const set=listeners.get(path)||new Set();set.add(callback);listeners.set(path,set);callback(snapshot(data.get(path)||null));},
    off(type,callback){(path==='.info/connected'?server.connectivity:listeners.get(path))?.delete(callback);},
    transaction(update){
      server.paths.push(path);
      const next=chain.then(()=>{
        if(server.fail)throw {code:'permission-denied'};
        const value=update(structuredClone(data.get(path) || null));data.set(path,structuredClone(value));
        listeners.get(path)?.forEach(callback=>callback(snapshot(value)));
        return {committed:true,snapshot:snapshot(value)};
      });chain=next.catch(()=>{});return next;
    }
  });
  server.setOnline=online=>{server.online=online;server.connectivity?.forEach(callback=>callback(snapshot(online)));};
  return server;
}
function client(server,uid='same-person'){
  let callback;const state=fresh(),statuses=[];
  const auth={currentUser:null,onAuthStateChanged(fn){callback=fn;return ()=>{};},async signOut(){this.currentUser=null;callback(null);},async signInWithPopup(){this.currentUser={uid};await callback(this.currentUser);}};
  function authFactory(){return auth;}
  authFactory.GoogleAuthProvider=class{setCustomParameters(){}};
  const firebase={apps:[{}],initializeApp(){},auth:authFactory,database:()=>({ref:server.ref})};
  const client=createCloudProgress({firebase,config:{projectId:'test-only'},getOwner:()=> 'maaike',getProfile:()=>makeProgressProfile(state,'maaike'),applyProfile:profile=>restoreProgressProfile(state,'maaike',profile),canBind:(owner,id)=>!state.binding || state.binding===id,bind:(owner,id)=>state.binding=id,onStatus:value=>statuses.push(value.state)});
  return {state,statuses,client,async login(){await client.init();return client.signIn();}};
}
const answer=id=>({id,date:'2026-10-23',createdAt:'2026-10-23T10:00:00Z',hindi:'पानी',english:['water'],category:'Lesson 1',correct:true,close:false,mode:'type'});

test('two devices join the same protected profile and converge without erasing answers',async()=>{
  const backend=service(),phone=client(backend),laptop=client(backend);
  phone.state.attempts.maaike.phase1.push(answer('phone'));
  await phone.login();await turn();
  laptop.state.attempts.maaike.phase1.push(answer('laptop'));
  await laptop.login();await turn();
  assert.equal(phone.state.attempts.maaike.phase1.length,2);assert.equal(laptop.state.attempts.maaike.phase1.length,2);
  phone.state.attempts.maaike.phase1.push(answer('phone2'));laptop.state.attempts.maaike.phase1.push(answer('laptop2'));
  await Promise.all([phone.client.flush(),laptop.client.flush()]);
  assert.equal(phone.state.attempts.maaike.phase1.length,4);assert.equal(laptop.state.attempts.maaike.phase1.length,4);
  assert.ok(backend.paths.every(path=>path==='hindiDuel/users/same-person/profiles/maaike'));
  phone.client.destroy();laptop.client.destroy();
});

test('offline answers survive locally and sync after connection returns',async()=>{
  const backend=service(),phone=client(backend);await phone.login();await turn();
  backend.setOnline(false);phone.state.attempts.maaike.phase1.push(answer('offline'));phone.client.schedule();
  assert.equal(await phone.client.flush(),false);assert.equal(phone.statuses.at(-1),'offline');
  assert.equal(phone.state.attempts.maaike.phase1.length,1);
  backend.setOnline(true);await turn();await phone.client.flush();
  assert.equal(backend.data.get('hindiDuel/users/same-person/profiles/maaike').attempts.phase1.length,1);
  assert.equal(phone.statuses.at(-1),'synced');phone.client.destroy();
});

test('a different account cannot upload a bound local learner profile',async()=>{
  const backend=service(),phone=client(backend,'different-account');phone.state.binding='original-account';phone.state.attempts.maaike.phase1.push(answer('private'));
  await phone.login();assert.equal(phone.statuses.at(-1),'account-mismatch');assert.equal(backend.paths.length,0);
  assert.equal(phone.state.attempts.maaike.phase1.length,1);phone.client.destroy();
});

test('permission errors never report success and keep local answers intact',async()=>{
  const backend=service();backend.fail=true;const phone=client(backend);phone.state.attempts.maaike.phase1.push(answer('private'));
  await phone.login();assert.equal(phone.statuses.at(-1),'error');assert.equal(phone.state.binding,undefined);assert.equal(phone.state.attempts.maaike.phase1.length,1);phone.client.destroy();
});

test('an unconfigured website remains local and makes no cloud calls',async()=>{
  const statuses=[];const sync=createCloudProgress({config:null,getOwner:()=> 'maaike',onStatus:value=>statuses.push(value.state)});
  assert.equal(await sync.init(),false);assert.equal(statuses.at(-1),'unconfigured');assert.equal(await sync.signIn(),false);sync.destroy();
});

test('a failed server write stays pending and can be retried without re-answering',async()=>{
  const backend=service(),phone=client(backend);await phone.login();await turn();
  backend.fail=true;phone.state.attempts.maaike.phase1.push(answer('unsent'));
  assert.equal(await phone.client.flush(),false);assert.equal(phone.statuses.at(-1),'error');
  assert.equal(phone.state.attempts.maaike.phase1.length,1);
  backend.fail=false;await phone.client.refresh();
  assert.equal(backend.data.get('hindiDuel/users/same-person/profiles/maaike').attempts.phase1.length,1);
  assert.equal(phone.statuses.at(-1),'synced');phone.client.destroy();
});
