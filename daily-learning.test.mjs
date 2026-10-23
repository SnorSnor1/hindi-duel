import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {PHASE_DATA} from "./data.js";
import {createDailyPractice} from "./daily-practice.js";

const source=readFileSync(new URL("./app.js",import.meta.url),"utf8");
function appFunction(name,next){
  return source.slice(source.indexOf(`function ${name}(`),source.indexOf(`function ${next}(`));
}
function learningContext(user=null){
  const empty=()=>({phase1:[],phase2:[],phase3:[]});
  const context={user,state:{attempts:{maaike:empty(),vincent:empty(),guest:empty()},dailyPractice:{},mistakes:{maaike:{phase3:{}},vincent:{phase3:{}}}},session:{source:"daily-practice",currentMode:"type",started:1},mode:"type",performance:{now:()=>100},today:()=>"2026-10-23",weekKey:()=>"2026-10-19",wordPhaseKey:word=>word.phaseKey,keyFor:word=>`${word.hindi}|${word.category}`,updateMistakeStatus:()=>{},scheduleSameSessionRepeat:()=>{}};
  context.save=()=>{context.persisted=structuredClone(context.state);};
  vm.createContext(context);
  vm.runInContext(appFunction("recordAttempt","updateMistakeStatus")+appFunction("approveAttempt","markAttemptHard")+appFunction("markAttemptHard","clearTimer")+appFunction("sharedState","mergeScores"),context);
  return context;
}
const diamond={...PHASE_DATA.phase3.words.find(word=>word.hindi==="हीरा"),phaseKey:"phase3"};
const words=Object.fromEntries(Object.entries(PHASE_DATA).map(([key,value])=>[key,value.words]));

test("guest errors are persisted after the answer and scheduled tomorrow without finishing the round",()=>{
  const context=learningContext();
  context.recordAttempt(diamond,false,false,"pearl",1500);
  assert.equal(context.persisted.attempts.guest.phase3.length,1);
  const next=createDailyPractice(words,PHASE_DATA,"2026-10-24",undefined,context.persisted.attempts.guest);
  assert.ok(next.some(word=>word.hindi==="हीरा" && word.review));
  assert.equal(context.persisted.attempts.maaike.phase3.length,0);
  assert.equal(context.sharedState().attempts.guest,undefined);
});

test("guest approval corrects the saved error and a hard answer is remembered",()=>{
  const context=learningContext();
  const id=context.recordAttempt(diamond,false,false,"gem",1500);
  context.approveAttempt(id,diamond);
  assert.equal(context.persisted.attempts.guest.phase3[0].correct,true);
  assert.equal(context.persisted.attempts.guest.phase3[0].approved,true);
  assert.ok(!createDailyPractice(words,PHASE_DATA,"2026-10-24",undefined,context.persisted.attempts.guest).some(word=>word.hindi==="हीरा" && word.review));
  context.markAttemptHard(id,diamond);
  assert.ok(createDailyPractice(words,PHASE_DATA,"2026-10-24",undefined,context.persisted.attempts.guest).some(word=>word.hindi==="हीरा" && word.review));
});

test("signed-in answers stay in the correct account and phase and are included in sync",()=>{
  const context=learningContext("maaike");
  context.recordAttempt(diamond,false,false,"pearl",1500);
  assert.equal(context.persisted.attempts.maaike.phase3.length,1);
  assert.equal(context.persisted.attempts.maaike.phase1.length,0);
  assert.equal(context.persisted.attempts.guest.phase3.length,0);
  assert.equal(context.sharedState().attempts.maaike.phase3.length,1);
});
