import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resumableRun} from './progress-sync.js';
const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const resume=source.slice(source.indexOf('function resumeDailyPractice(){'),source.indexOf('function dailyPracticeQuestionHtml('));
function savedRun(total,index){return {id:'old-round',source:'daily-practice',startedAt:'2026-10-22T10:00:00Z',date:'2026-10-22',phaseKey:'phase1',queue:Array.from({length:total},()=>({hindi:'पानी',english:['water'],phaseKey:'phase1',practiceMode:'type'})),index,correct:index,wrong:0,approved:0,missed:[]};}
function resumed(run,limit){
  const context={state:{practiceRuns:{guest:run}},user:null,phase:'phase1',session:null,resumableRun,dailyPracticeLimit:()=>limit,show:()=>{},markActiveNav:()=>{},save:()=>{},renderQuestion:()=>{},wordSessionKey:word=>word.hindi};
  vm.createContext(context);vm.runInContext(resume,context);context.resumeDailyPractice();return context.session;
}

test('resuming a legacy 191-word round keeps answered words and caps the total at 20',()=>{
  const run=savedRun(191,1),session=resumed(run,20);
  assert.equal(session.queue.length,20);assert.equal(session.index,1);assert.equal(session.correct,1);
  assert.equal(run.queue.length,191);
});

test('a legacy round already beyond the cap finishes without another question',()=>{
  const session=resumed(savedRun(191,40),20);
  assert.equal(session.queue.length,40);assert.equal(session.index,40);assert.equal(session.correct,40);
});

test('a saved round can be shortened to 10 without discarding prior answers',()=>{
  const session=resumed(savedRun(20,3),10);
  assert.equal(session.queue.length,10);assert.equal(session.index,3);assert.equal(session.correct,3);
});
