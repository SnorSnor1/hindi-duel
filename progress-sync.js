// One learner profile per authenticated account path. No passwords or tokens.
import { learningHistory } from './daily-practice.js?v=20261023-7';

export const PROFILE_NAMES = ['maaike','vincent'];
export const SYNC_VERSION = 2;
const PHASES = ['phase1','phase2','phase3'];
const list = value=>Array.isArray(value)?value:Object.values(value || {});
const stamp = value=>[value?.updatedAt,value?.approvedAt,value?.markedHardAt,value?.lastWrongAt,value?.lastCorrectAt,value?.createdAt].filter(Boolean).sort().at(-1) || '';
const stable = value=>JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
// Match local JSON persistence: Firebase rejects undefined optional fields.
const storedValue = value=>JSON.parse(JSON.stringify(value));
function newest(a,b){
  if(!a) return b;
  if(!b) return a;
  return stamp(b)>stamp(a) || (stamp(b)===stamp(a) && stable(b)>stable(a)) ? b : a;
}
function mergeList(a,b,key){
  const entries = new Map();
  [...list(a),...list(b)].filter(Boolean).forEach(value=>{
    const id = key(value);
    if(id) entries.set(id,newest(entries.get(id),value));
  });
  return [...entries].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value);
}
function rows(bucket){return Object.entries(bucket || {}).map(([key,value])=>({key,value}));}
function mergeRows(a,b){
  const result = new Map();
  [...list(a),...list(b)].filter(row=>row && typeof row.key==='string' && row.value && typeof row.value==='object').forEach(row=>{
    result.set(row.key,{key:row.key,value:newest(result.get(row.key)?.value,row.value)});
  });
  return [...result.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
const fromRows = value=>Object.fromEntries(list(value).filter(row=>typeof row?.key==='string' && row.key!=='__proto__' && row.value).map(row=>[row.key,row.value]));

export function mergeRun(a,b){
  if(!a) return b || null;
  if(!b) return a;
  if(a.id!==b.id) return `${b.startedAt}|${b.id}` > `${a.startedAt}|${a.id}` ? b : a;
  if(Boolean(a.completed)!==Boolean(b.completed)) return b.completed?b:a;
  if(a.index!==b.index) return b.index>a.index?b:a;
  return newest(a,b);
}

export function makeProgressProfile(state, owner, options={}){
  return storedValue({
    version:SYNC_VERSION,
    attempts:Object.fromEntries(PHASES.map(phase=>[phase,state.attempts?.[owner]?.[phase] || []])),
    scores:state.scores?.[owner] || [],
    mistakes:Object.fromEntries(PHASES.map(phase=>[phase,rows(state.mistakes?.[owner]?.[phase])])),
    wordOverrides:Object.fromEntries(PHASES.map(phase=>[phase,rows(state.wordOverrides?.[phase])])),
    dailyPractice:(options.includeGuest ? newest(state.dailyPractice?.[owner],state.dailyPractice?.guest) : state.dailyPractice?.[owner]) || null,
    run:options.includeGuest ? mergeRun(state.practiceRuns?.[owner],state.practiceRuns?.guest) : state.practiceRuns?.[owner] || null,
    scoreResets:rows(state.scoreResets?.[owner]),
    reminder:state.reminder || {},settings:(options.includeGuest ? newest(state.practiceSettings?.[owner],state.practiceSettings?.guest) : state.practiceSettings?.[owner]) || {},
    ...(options.includeGuest ? {attempts:Object.fromEntries(PHASES.map(phase=>[phase,mergeList(state.attempts?.[owner]?.[phase],state.attempts?.guest?.[phase],attemptKey)]))} : {})
  });
}
const attemptKey = a=>a.id || `${a.date}|${a.createdAt}|${a.hindi}|${a.category}|${a.answer}`;
const scoreKey = a=>a.phase && a.date ? `${a.phase}|${a.date}` : '';

export function mergeProgressProfiles(local={}, remote={}){
  if(remote.version && remote.version!==SYNC_VERSION) throw new Error('unsupported-sync-version');
  const attempts = Object.fromEntries(PHASES.map(phase=>[phase,mergeList(local.attempts?.[phase],remote.attempts?.[phase],attemptKey).sort((a,b)=>(a.createdAt || a.date || '').localeCompare(b.createdAt || b.date || '') || attemptKey(a).localeCompare(attemptKey(b)))]));
  const scoreResets = mergeRows(local.scoreResets,remote.scoreResets);
  const resetMap = fromRows(scoreResets);
  const scores = mergeList(local.scores,remote.scores,scoreKey).filter(score=>!resetMap[scoreKey(score)] || stamp(score)>stamp(resetMap[scoreKey(score)]));
  return storedValue({
    version:SYNC_VERSION,attempts,scores,scoreResets,
    mistakes:Object.fromEntries(PHASES.map(phase=>[phase,mergeRows(local.mistakes?.[phase],remote.mistakes?.[phase])])),
    wordOverrides:Object.fromEntries(PHASES.map(phase=>[phase,mergeRows(local.wordOverrides?.[phase],remote.wordOverrides?.[phase])])),
    dailyPractice:newest(local.dailyPractice,remote.dailyPractice) || null,
    run:mergeRun(local.run,remote.run),reminder:newest(local.reminder,remote.reminder) || {},settings:newest(local.settings,remote.settings) || {}
  });
}

export function restoreProgressProfile(state, owner, incoming){
  const profile=mergeProgressProfiles(makeProgressProfile(state,owner),incoming);
  state.attempts[owner]=profile.attempts;
  state.scores[owner]=profile.scores;
  state.dailyPractice[owner]=profile.dailyPractice;
  state.practiceRuns ||= {}; state.practiceRuns[owner]=profile.run;
  state.scoreResets ||= {}; state.scoreResets[owner]=fromRows(profile.scoreResets);
  state.mistakes[owner]=Object.fromEntries(PHASES.map(phase=>[phase,deriveMistakes(profile.attempts[phase],fromRows(profile.mistakes[phase]))]));
  state.wordOverrides=Object.fromEntries(PHASES.map(phase=>[phase,fromRows(profile.wordOverrides[phase])]));
  state.reminder=profile.reminder;
  state.practiceSettings ||= {};state.practiceSettings[owner]=profile.settings;
  return profile;
}

function deriveMistakes(attempts, legacy){
  const history=learningHistory({all:attempts},'9999-12-31',true);
  const encountered=new Set(attempts.map(a=>`${a.hindi}|${a.category}`));
  const result=Object.fromEntries(Object.entries(legacy).filter(([key])=>!encountered.has(key)));
  for(const [key,stats] of history){
    if(!stats.reviewDue || !stats.failure) continue;
    const a=stats.failure;
    const bucketKey=`${a.hindi}|${a.category}`;
    result[bucketKey]={...a,count:stats.wrongCount,streak:0,repairDays:[...new Set(attempts.filter(item=>item.correct && !item.close && item.date>a.date && item.hindi===a.hindi).map(item=>item.date))],lastWrongAt:a.createdAt,lastAnswer:a.answer || ''};
  }
  return result;
}

export function sessionCheckpoint(session, now){
  if(session?.source!=='daily-practice' || !session.runId) return null;
  return {id:session.runId,source:'daily-practice',startedAt:session.runStartedAt,updatedAt:now,
    date:session.date,queue:session.queue,index:session.index+(session.awaitingNext?1:0),
    correct:session.correct,wrong:session.wrong,approved:session.approved || 0,
    phaseKey:session.phaseKey,completed:Boolean(session.completed),missed:Object.values(session.missed || {})};
}

export function resumableRun(run){
  return Boolean(run && !run.completed && run.source==='daily-practice' && typeof run.id==='string' &&
    Array.isArray(run.queue) && run.queue.length && run.queue.length<=10000 &&
    Number.isInteger(run.index) && run.index>=0 && run.index<=run.queue.length &&
    (!run.missed || Array.isArray(run.missed)) &&
    Number.isInteger(run.correct) && run.correct>=0 && run.correct<=run.queue.length &&
    Number.isInteger(run.wrong) && run.wrong>=0 && run.wrong<=run.queue.length &&
    run.queue.every(word=>word && PHASES.includes(word.phaseKey) && typeof word.hindi==='string' && Array.isArray(word.english) && word.english.length && word.english.every(answer=>typeof answer==='string')));
}

export function privateProgressPath(uid, owner){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') || !PROFILE_NAMES.includes(owner)) throw new Error('invalid-sync-identity');
  return `hindiDuel/users/${uid}/profiles/${owner}`;
}
