import test from "node:test";
import assert from "node:assert/strict";
import { PHASE_DATA } from "./data.js";
import { createDailyPractice, mergeDailyPractice, learningHistory } from "./daily-practice.js";
import { CORE_THEMES,coreTheme,importantWords,learningKey } from "./core-vocabulary.js";

const words = Object.fromEntries(Object.entries(PHASE_DATA).map(([phase,data])=>[phase,data.words]));
const key = (word)=>`${word.phaseKey}|${word.category}|${word.hindi}`;

test("daily round prioritises essentials and keeps phases and lessons in ascending order",()=>{
  const round = createDailyPractice(words, PHASE_DATA, "2026-10-23");
  assert.equal(round.length,20);
  assert.equal(new Set(round.map(key)).size,20);
  assert.deepEqual(round.map(w=>w.phaseKey),[...Array(6).fill("phase1"),...Array(7).fill("phase2"),...Array(7).fill("phase3")]);
  assert.ok(round.every(word=>word.core));
  assert.equal(new Set(round.map(learningKey)).size,20);
  for(const phase of Object.keys(words)){
    const categories=[...new Set(words[phase].map(word=>word.category))];
    const ranks=round.filter(w=>w.phaseKey===phase).map(w=>categories.indexOf(w.category));
    assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b));
  }
});

const one = (phase,hindi)=>({...words[phase].find(word=>learningKey(word)===learningKey(hindi)),phaseKey:phase});
const attempt = (word,date,correct,extra={})=>({...word,phase:word.phaseKey,date,createdAt:`${date}T10:00:00Z`,correct,close:false,mode:"type",source:"practice",...extra});

test("the editorial selection only contains existing words, with everyday needs before story props",()=>{
  const available=new Set(Object.values(words).flat().map(learningKey));
  assert.ok(CORE_THEMES.flatMap(theme=>theme.words).every(word=>available.has(learningKey(word))));
  const selection=importantWords(words);
  assert.equal(new Set(selection.map(learningKey)).size,selection.length);
  for(const hindi of ["पानी","चाहिए","मदद मांगना","सही","क्या हाल है?"]) assert.ok(coreTheme(hindi));
  for(const hindi of ["परी","हीरा","जादूई छड़ी","गिद्ध"]) assert.equal(coreTheme(hindi),null);
});

test("a missed nonessential word from any practice returns tomorrow, even after a same-day correction",()=>{
  const diamond=one("phase3","हीरा");
  const attempts={phase3:[attempt(diamond,"2026-10-22",false),attempt(diamond,"2026-10-22",true,{createdAt:"2026-10-22T11:00:00Z"})]};
  const next=createDailyPractice(words,PHASE_DATA,"2026-10-23",undefined,attempts);
  assert.ok(next.some(word=>learningKey(word)===learningKey(diamond) && word.review && !word.core));
});

test("today's answers do not change today's set or add same-day reviews",()=>{
  const original=createDailyPractice(words,PHASE_DATA,"2026-10-23");
  const missed=one("phase3","हीरा");
  const attempts={phase3:[attempt(missed,"2026-10-23",false)]};
  assert.deepEqual(createDailyPractice(words,PHASE_DATA,"2026-10-23",undefined,attempts),original);
  assert.ok(createDailyPractice(words,PHASE_DATA,"2026-10-24",undefined,attempts).some(word=>word.hindi===missed.hindi && word.review));
});

test("a review stays due until it is correct on two later, separate days",()=>{
  const missed=one("phase3","हीरा");
  const attempts={phase3:[attempt(missed,"2026-10-20",false),attempt(missed,"2026-10-21",true)]};
  assert.equal(learningHistory(attempts,"2026-10-22").get(learningKey(missed)).reviewDue,true);
  attempts.phase3.push(attempt(missed,"2026-10-21",true,{createdAt:"2026-10-21T12:00:00Z"}));
  assert.equal(learningHistory(attempts,"2026-10-22").get(learningKey(missed)).reviewDue,true);
  attempts.phase3.push(attempt(missed,"2026-10-22",true));
  assert.equal(learningHistory(attempts,"2026-10-23").get(learningKey(missed)).reviewDue,false);
  attempts.phase3.push(attempt(missed,"2026-10-23",false));
  assert.equal(learningHistory(attempts,"2026-10-24").get(learningKey(missed)).reviewDue,true);
});

test("all due errors are included, including backlog beyond the normal daily quota",()=>{
  const failures=words.phase3.slice(0,25);
  const attempts={phase3:failures.map(word=>attempt({...word,phaseKey:"phase3"},"2026-10-22",false))};
  const next=createDailyPractice(words,PHASE_DATA,"2026-10-23",undefined,attempts);
  const selected=new Set(next.map(learningKey));
  assert.ok(failures.every(word=>selected.has(learningKey(word))));
  assert.equal(next.filter(word=>word.review).length,new Set(failures.map(learningKey)).size);
  assert.ok(next.length>20);
  assert.ok(next.slice(0,6).every(word=>word.phaseKey==="phase1"));
});

test("recognition advances to typing, and three successful days include active recall",()=>{
  const water=one("phase1","पानी");
  const attempts={phase1:[attempt(water,"2026-10-20",true,{mode:"mc"}),attempt(water,"2026-10-21",true,{mode:"mc"}),attempt(water,"2026-10-22",true,{mode:"mc"})]};
  assert.equal(learningHistory(attempts,"2026-10-23").get(learningKey(water)).mastered,false);
  const pool={phase1:[water]};const curriculum={phase1:{words:[water]}};
  assert.equal(createDailyPractice(pool,curriculum,"2026-10-23",["phase1"],attempts)[0].practiceMode,"type");
  attempts.phase1.push(attempt(water,"2026-10-23",true));
  assert.equal(learningHistory(attempts,"2026-10-23").get(learningKey(water)).mastered,false);
  assert.equal(learningHistory(attempts,"2026-10-23",true).get(learningKey(water)).mastered,true);
});

test("duplicates across lessons and phases are learned as one word and reviewed only once",()=>{
  const buy=one("phase2","खरीदना");
  const attempts={phase2:[attempt(buy,"2026-10-22",false),attempt({...buy,category:"Lesson 14b"},"2026-10-22",false)]};
  const next=createDailyPractice(words,PHASE_DATA,"2026-10-23",undefined,attempts);
  assert.equal(next.filter(word=>learningKey(word)===learningKey(buy)).length,1);
});

test("approved answers are not repeated as mistakes, while difficult answers get a review",()=>{
  const diamond=one("phase3","हीरा");
  const approved={phase3:[attempt(diamond,"2026-10-22",true,{approved:true})]};
  assert.equal(learningHistory(approved,"2026-10-23").get(learningKey(diamond)).reviewDue,false);
  const difficult={phase3:[attempt(diamond,"2026-10-22",true,{close:true})]};
  assert.equal(learningHistory(difficult,"2026-10-23").get(learningKey(diamond)).reviewDue,true);
});

test("a day's words stay stable, vary the next day and ignore saved word order",()=>{
  const round = createDailyPractice(words,PHASE_DATA,"2026-10-23").map(key);
  assert.deepEqual(createDailyPractice(words,PHASE_DATA,"2026-10-23").map(key),round);
  assert.deepEqual(createDailyPractice(Object.fromEntries(Object.entries(words).map(([phase,list])=>[phase,[...list].reverse()])),PHASE_DATA,"2026-10-23").map(key),round);
  assert.notDeepEqual(createDailyPractice(words,PHASE_DATA,"2026-10-24").map(key),round);
});

test("manual word changes keep their place and missing phases don't break a round",()=>{
  const edited=structuredClone(words);
  for(const word of edited.phase1){
    word.overrideKey=`phase1|${word.hindi}|${word.category}`;
    word.hindi+=" edited";
    word.english=["my answer"];
  }
  const round=createDailyPractice(edited,PHASE_DATA,"2026-10-23");
  assert.ok(round.filter(w=>w.phaseKey==="phase1").every(w=>w.hindi.endsWith(" edited") && w.english[0]==="my answer"));
  assert.equal(createDailyPractice({phase3:words.phase3},PHASE_DATA,"2026-10-23").length,7);
  assert.equal(createDailyPractice(words,PHASE_DATA,"2026-10-23",["phase1","phase3"]).length,13);
  assert.deepEqual(createDailyPractice({},PHASE_DATA,"2026-10-23"),[]);
});

test("sync preserves each user's newest completed round and local guest result",()=>{
  const previous={date:"2026-10-22",correct:10,total:20,updatedAt:"2026-10-22T10:00:00Z"};
  const current={date:"2026-10-23",correct:18,total:20,updatedAt:"2026-10-23T10:00:00Z"};
  assert.deepEqual(mergeDailyPractice({maaike:current,guest:previous},{maaike:previous,vincent:current}),{maaike:current,vincent:current,guest:previous});
  assert.deepEqual(mergeDailyPractice({}, {maaike:{date:"2026-10-23",correct:30,total:20}}),{});
});

test("known words rest through expanding intervals and are never fillers before they are due",()=>{
  const water=one("phase1","पानी");
  const attempts={phase1:[attempt(water,"2026-10-01",true),attempt(water,"2026-10-03",true),attempt(water,"2026-10-10",true)]};
  const pool={phase1:[water]}, curriculum={phase1:{words:[water]}};
  const stats=learningHistory(attempts,"2026-10-11").get(learningKey(water));
  assert.equal(stats.mastered,true);
  assert.equal(stats.intervalDays,7);
  assert.equal(stats.dueAt,"2026-10-17");
  assert.equal(stats.resting,true);
  assert.deepEqual(createDailyPractice(pool,curriculum,"2026-10-16",["phase1"],attempts),[]);
  const due=createDailyPractice(pool,curriculum,"2026-10-17",["phase1"],attempts);
  assert.equal(due.length,1);
  assert.equal(due[0].scheduledReview,true);
  assert.equal(due[0].review,false);
});

test("a new failure resets a previously mastered word and rebuilds its interval",()=>{
  const water=one("phase1","पानी");
  const attempts={phase1:["01","03","05","07","09","11"].map(day=>attempt(water,`2026-10-${day}`,true))};
  assert.equal(learningHistory(attempts,"2026-10-12").get(learningKey(water)).intervalDays,60);
  attempts.phase1.push(attempt(water,"2026-10-12",false));
  let stats=learningHistory(attempts,"2026-10-13").get(learningKey(water));
  assert.equal(stats.intervalDays,1);assert.equal(stats.mastered,false);assert.equal(stats.reviewDue,true);
  attempts.phase1.push(attempt(water,"2026-10-13",true),attempt(water,"2026-10-14",true));
  stats=learningHistory(attempts,"2026-10-15").get(learningKey(water));
  assert.equal(stats.reviewDue,false);assert.equal(stats.intervalDays,3);assert.equal(stats.mastered,false);
});

test("same-day repetitions cannot manufacture mastery or a longer interval",()=>{
  const water=one("phase1","पानी");
  const attempts={phase1:Array.from({length:25},(_,index)=>attempt(water,"2026-10-22",true,{createdAt:`2026-10-22T10:${String(index).padStart(2,"0")}:00Z`}))};
  const stats=learningHistory(attempts,"2026-10-23").get(learningKey(water));
  assert.equal(stats.successDays,1);assert.equal(stats.intervalDays,1);assert.equal(stats.mastered,false);
});

test("a due familiar word takes priority over unseen words, and future words keep resting",()=>{
  const water=one("phase1","पानी");
  const todayPlan=createDailyPractice(words,PHASE_DATA,"2026-10-23",undefined,{phase1:[attempt(water,"2026-10-22",true)]});
  assert.ok(todayPlan.some(word=>learningKey(word)===learningKey(water) && word.scheduledReview));
});

test('free practice prioritises difficult and due words while allowing an explicitly requested resting word',async()=>{
  const {prioritisePractice}=await import('./daily-practice.js');
  const water=one('phase1','पानी'),food=one('phase1','खाना'),tea=one('phase1','चाय'),milk=one('phase1','दूध');
  const history=new Map([[learningKey(water),{resting:true}],[learningKey(food),{reviewDue:true}],[learningKey(tea),{due:true}]]);
  assert.deepEqual(prioritisePractice([water,milk,tea,food],history,()=>0).map(learningKey),[food,tea,milk,water].map(learningKey));
});
