import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProgressProfile,restoreProgressProfile,mergeProgressProfiles,mergeRun,sessionCheckpoint,resumableRun,privateProgressPath} from './progress-sync.js';
const phaseEmpty=()=>({phase1:[],phase2:[],phase3:[]});
const initial=()=>({attempts:{maaike:phaseEmpty(),vincent:phaseEmpty(),guest:phaseEmpty()},scores:{maaike:[],vincent:[]},mistakes:{maaike:{},vincent:{}},dailyPractice:{},wordOverrides:{},reminder:{time:'08:00'}});
const a=(id,date='2026-10-23',correct=true)=>({id,date,createdAt:`${date}T10:00:00Z`,hindi:'पानी',english:['water'],category:'Lesson / 1.a',correct,close:false,mode:'type'});
const round={source:'daily-practice',runId:'run1',runStartedAt:'2026-10-23T10:00:00Z',date:'2026-10-23',queue:[{hindi:'पानी',english:['water'],category:'Lesson / 1.a',phaseKey:'phase1',practiceMode:'type'},{hindi:'चाय',english:['tea'],category:'Lesson / 1.a',phaseKey:'phase1',practiceMode:'type'}],index:0,correct:0,wrong:0,missed:{}};

test('each Google identity and learner profile gets its own protected path',()=>{
  assert.notEqual(privateProgressPath('googleOne','maaike'),privateProgressPath('googleTwo','maaike'));
  assert.notEqual(privateProgressPath('googleOne','maaike'),privateProgressPath('googleOne','vincent'));
  for(const uid of ['','../other','bad/uid','a.b']) assert.throws(()=>privateProgressPath(uid,'maaike'));
  assert.throws(()=>privateProgressPath('googleOne','guest'));
});

test('sync exports only the selected learner and never passwords, identity tokens or another profile',()=>{
  const state=initial();state.attempts.maaike.phase1=[a('own')];state.attempts.vincent.phase1=[a('other')];state.attempts.guest.phase1=[a('guest')];
  state.user='maaike';state.secret='do not export';
  const profile=makeProgressProfile(state,'maaike');
  assert.deepEqual(profile.attempts.phase1.map(item=>item.id),['own']);
  assert.equal(profile.user,undefined);assert.equal(profile.secret,undefined);
  assert.deepEqual(makeProgressProfile(state,'maaike',{includeGuest:true}).attempts.phase1.map(item=>item.id),['guest','own']);
});

test('concurrent phone and laptop answers merge in either order and repeated sync is idempotent',()=>{
  const one=initial(),two=initial();one.attempts.maaike.phase1=[a('phone')];two.attempts.maaike.phase1=[a('laptop')];
  const x=makeProgressProfile(one,'maaike'),y=makeProgressProfile(two,'maaike');
  const merged=mergeProgressProfiles(x,y);
  assert.deepEqual(merged,mergeProgressProfiles(y,x));
  assert.equal(merged.attempts.phase1.length,2);
  assert.deepEqual(mergeProgressProfiles(merged,merged),merged);
});

test('a stale device cannot undo Count as correct or Felt hard',()=>{
  const state=initial();state.attempts.maaike.phase1=[a('one','2026-10-22',false)];
  const stale=makeProgressProfile(structuredClone(state),'maaike');
  state.attempts.maaike.phase1[0]={...state.attempts.maaike.phase1[0],correct:true,approved:true,approvedAt:'2026-10-23T10:00:00Z'};
  const approved=mergeProgressProfiles(makeProgressProfile(state,'maaike'),stale);
  assert.equal(approved.attempts.phase1[0].correct,true);
  const hard=structuredClone(approved);hard.attempts.phase1[0].close=true;hard.attempts.phase1[0].markedHardAt='2026-10-23T11:00:00Z';
  assert.equal(mergeProgressProfiles(hard,approved).attempts.phase1[0].close,true);
});

test('old mistake buckets cannot resurrect a word repaired on two later days',()=>{
  const old=initial();old.attempts.maaike.phase1=[a('wrong','2026-10-20',false)];old.mistakes.maaike.phase1={'पानी|Lesson / 1.a':{...a('wrong','2026-10-20',false),count:1}};
  const repaired=structuredClone(old);repaired.attempts.maaike.phase1.push(a('right1','2026-10-21'),a('right2','2026-10-22'));repaired.mistakes.maaike.phase1={};
  restoreProgressProfile(repaired,'maaike',makeProgressProfile(old,'maaike'));
  assert.deepEqual(repaired.mistakes.maaike.phase1,{});
  assert.equal(repaired.attempts.maaike.phase1.length,3);
});

test('score resets survive stale sync and permit a new attempt after the reset',()=>{
  const state=initial();state.scores.maaike=[{date:'2026-10-23',phase:'phase1',correct:12,total:20,updatedAt:'2026-10-23T10:00:00Z'}];
  const stale=makeProgressProfile(state,'maaike');state.scores.maaike=[];state.scoreResets={maaike:{'phase1|2026-10-23':{updatedAt:'2026-10-23T11:00:00Z'}}};
  const reset=mergeProgressProfiles(makeProgressProfile(state,'maaike'),stale);
  assert.equal(reset.scores.length,0);
  reset.scores.push({...stale.scores[0],updatedAt:'2026-10-23T12:00:00Z'});
  assert.equal(mergeProgressProfiles(reset,stale).scores.length,1);
});

test('Hindi/category punctuation remains valid Firebase data, including saved missed words',()=>{
  const state=initial();state.wordOverrides={phase1:{'phase1|पानी.|Lesson / 1.a':{hindi:'पानी.',english:['water'],category:'Lesson / 1.a'}}};
  const run=sessionCheckpoint({...round,missed:{'phase1|पानी.|Lesson / 1.a':round.queue[0]}},'2026-10-23T10:00:00Z');
  state.practiceRuns={maaike:run};const profile=makeProgressProfile(state,'maaike');
  function check(value){if(!value || typeof value!=='object')return;for(const [key,item] of Object.entries(value)){assert.doesNotMatch(key,/[.#$\[\]/\n\r]/);check(item);}}
  check(profile);
  restoreProgressProfile(state,'maaike',profile);
  assert.equal(state.wordOverrides.phase1['phase1|पानी.|Lesson / 1.a'].hindi,'पानी.');
});

test('a saved daily run continues at the next unanswered word and never regresses on stale sync',()=>{
  const first=sessionCheckpoint(round,'2026-10-23T10:00:00Z');
  const next=sessionCheckpoint({...round,awaitingNext:true,correct:1},'2026-10-23T10:01:00Z');
  assert.equal(next.index,1);assert.ok(resumableRun(next));
  assert.equal(mergeRun(next,{...first,updatedAt:'2026-10-23T11:00:00Z'}).index,1);
  const completed={...next,completed:true};assert.equal(mergeRun(completed,next).completed,true);assert.equal(resumableRun(completed),false);
  const newer={...first,id:'run2',startedAt:'2026-10-24T09:00:00Z'};
  assert.equal(mergeRun({...next,updatedAt:'2026-10-25T10:00:00Z'},newer).id,'run2');
});

test('bad future profile versions and malformed resumable queues are rejected',()=>{
  assert.throws(()=>mergeProgressProfiles({}, {version:99}));
  assert.equal(resumableRun({...sessionCheckpoint(round,'now'),index:1000}),false);
  assert.equal(resumableRun({...sessionCheckpoint(round,'now'),queue:[null]}),false);
  assert.equal(resumableRun({...sessionCheckpoint(round,'now'),correct:'one'}),false);
  assert.equal(resumableRun({...sessionCheckpoint(round,'now'),queue:[{hindi:'test',english:[],phaseKey:'private'}]}),false);
});

test('explicit guest import carries the saved daily position and result into the connected learner',()=>{
  const state=initial();state.practiceRuns={guest:sessionCheckpoint({...round,awaitingNext:true,correct:1},'2026-10-23T10:01:00Z')};state.dailyPractice.guest={date:'2026-10-22',correct:15,total:20,updatedAt:'2026-10-22T10:00:00Z'};
  const profile=makeProgressProfile(state,'maaike',{includeGuest:true});
  assert.equal(profile.run.index,1);assert.equal(profile.dailyPractice.correct,15);
  assert.equal(makeProgressProfile(state,'maaike').run,null);
  restoreProgressProfile(state,'maaike',profile);
  assert.equal(state.practiceRuns.maaike.index,1);
  assert.equal(state.practiceRuns.guest.index,1);
});
