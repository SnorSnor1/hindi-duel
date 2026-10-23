import test from "node:test";
import assert from "node:assert/strict";
import { PHASE_DATA } from "./data.js";
import { createDailyPractice, mergeDailyPractice } from "./daily-practice.js";

const words = Object.fromEntries(Object.entries(PHASE_DATA).map(([phase,data])=>[phase,data.words]));
const key = (word)=>`${word.phaseKey}|${word.category}|${word.hindi}`;

test("daily round spans the curriculum in ascending order, including the first and last lesson",()=>{
  const round = createDailyPractice(words, PHASE_DATA, "2026-10-23");
  assert.equal(round.length,20);
  assert.equal(new Set(round.map(key)).size,20);
  assert.deepEqual(round.map(w=>w.phaseKey),[...Array(6).fill("phase1"),...Array(7).fill("phase2"),...Array(7).fill("phase3")]);
  assert.equal(round[0].category,PHASE_DATA.phase1.words[0].category);
  assert.equal(round.at(-1).category,"Aladdin · Lesson 22");
  for(const phase of Object.keys(words)){
    const ranks=round.filter(w=>w.phaseKey===phase).map(w=>words[phase].findIndex(candidate=>candidate.hindi===w.hindi && candidate.category===w.category));
    assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b));
  }
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
