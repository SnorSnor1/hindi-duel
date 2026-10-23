import { mergeProgressProfiles, privateProgressPath } from './progress-sync.js?v=20261023-8';

// Firebase is injected so merging/retries can be checked without production data.
export function createCloudProgress({firebase,config,getOwner,getProfile,applyProfile,canBind,bind,onStatus}){
  let auth, database, reference, listener, authStop, connectedRef, connectedListener;
  let ready=false, connected=false, timer=null, inFlight=null, dirty=false, generation=0;
  let lastAcknowledged='', revision=0;
  const status=(state,detail='')=>onStatus({state,detail,owner:getOwner()});
  function detach(){
    generation++; clearTimeout(timer); ready=false; connected=false; lastAcknowledged='';
    if(reference && listener) reference.off('value',listener);
    if(connectedRef && connectedListener) connectedRef.off('value',connectedListener);
    reference=null; listener=null; connectedRef=null; connectedListener=null;
  }
  function errorMessage(error){
    if(String(error?.code).includes('permission')) return 'Cloud access was denied. Check the private database rules and Google sign-in setup.';
    if(String(error?.code).includes('popup-blocked')) return 'Allow the Google sign-in window, or open this website in Safari or Chrome.';
    if(String(error?.code).includes('popup-closed')) return 'Sign-in was cancelled. Your local progress is safe.';
    if(String(error?.code).includes('unauthorized-domain')) return 'This website still needs to be added to Firebase Authentication’s authorized domains.';
    return 'Could not connect. Your answers remain saved on this device. Retry when you are online.';
  }
  async function connect(identity){
    detach();
    if(!identity){status('signed-out');return false;}
    const owner=getOwner(), token=generation;
    if(!canBind(owner,identity.uid)){status('account-mismatch','This local profile is linked to another Google account. Use that original account; nothing has been uploaded.');return false;}
    status('connecting');
    try{
      const ref=database.ref(privateProgressPath(identity.uid,owner));
      const snapshot=await ref.get();
      if(token!==generation) return false;
      // Only bind after the protected server read succeeds.
      applyProfile(mergeProgressProfiles(getProfile(),snapshot.val() || {}),owner);
      bind(owner,identity.uid);
      reference=ref;ready=true;
      listener=snapshot=>{
        if(token!==generation) return;
        try{applyProfile(snapshot.val() || {},owner);}catch(error){ready=false;status('error','This cloud profile uses an unsupported format. Local progress was kept.');}
      };
      ref.on('value',listener,error=>{if(token===generation){ready=false;status('error',errorMessage(error));}});
      connectedRef=database.ref('.info/connected');
      connectedListener=snapshot=>{
        if(token!==generation) return;
        connected=Boolean(snapshot.val());
        if(!connected) status('offline');
        else {status('syncing');flush();}
      };
      dirty=true;
      connectedRef.on('value',connectedListener);
      await flush();
      return true;
    }catch(error){if(token===generation) status('error',errorMessage(error));return false;}
  }
  function schedule(){
    dirty=true;revision++;
    clearTimeout(timer);
    if(ready){status(connected?'syncing':'offline');timer=setTimeout(()=>flush(),400);}
  }
  async function flush(){
    clearTimeout(timer);
    if(!ready || !reference) return false;
    if(!connected){status('offline');return false;}
    if(inFlight?.generation===generation) return inFlight.promise;
    const payload=getProfile(), serialized=JSON.stringify(payload);
    if(serialized===lastAcknowledged && !dirty){status('synced');return true;}
    const token=generation, owner=getOwner(), startedRevision=revision;
    status('syncing'); dirty=false;
    const target=reference;
    const flight={generation:token,promise:null};inFlight=flight;
    flight.promise=(async()=>{
      try{
        // A transaction retries against the latest server value. A phone cannot
        // overwrite attempts written concurrently by a laptop.
        const result=await target.transaction(remote=>mergeProgressProfiles(payload,remote || {}),undefined,false);
        if(token!==generation) return false;
        if(!result.committed) throw new Error('not-committed');
        const acknowledged=result.snapshot.val() || {};
        applyProfile(acknowledged,owner);
        lastAcknowledged=JSON.stringify(getProfile());
        if(startedRevision!==revision){dirty=true;lastAcknowledged='';}
        status(connected?(dirty?'syncing':'synced'):'offline');
        return true;
      }catch(error){if(token===generation){dirty=true;status(connected?'error':'offline',connected?errorMessage(error):'');}return false;}
      finally{if(inFlight===flight) inFlight=null;if(token===generation && dirty && connected && startedRevision!==revision) schedule();}
    })();
    return flight.promise;
  }
  async function init(){
    if(!config){status('unconfigured');return false;}
    if(!firebase?.initializeApp || !firebase?.auth || !firebase?.database){status('error','The sign-in service did not load. Refresh when online.');return false;}
    if(!firebase.apps.length) firebase.initializeApp(config);
    auth=firebase.auth();database=firebase.database();
    authStop=auth.onAuthStateChanged(identity=>connect(identity));
    return true;
  }
  async function signIn(){
    if(!auth) return false;
    if(auth.currentUser) return connect(auth.currentUser);
    const provider=new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    try{await auth.signInWithPopup(provider);return true;}
    catch(error){status('error',errorMessage(error));return false;}
  }
  async function signOut(){
    flush();detach();
    if(auth) await auth.signOut();
    status(config?'signed-out':'unconfigured');
  }
  async function refresh(){
    if(!reference || !ready) return auth?.currentUser ? connect(auth.currentUser) : false;
    const token=generation,owner=getOwner();
    try{
      const snapshot=await reference.get();
      if(token!==generation) return false;
      applyProfile(snapshot.val() || {},owner);
      return flush();
    }catch(error){if(token===generation) status('offline');return false;}
  }
  return {init,signIn,signOut,schedule,flush,refresh,destroy(){detach();authStop?.();}};
}
