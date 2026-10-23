import test from 'node:test';
import assert from 'node:assert/strict';
import { learningDashboard } from './learning-dashboard.js';
import { reviewDate } from './daily-practice.js';
const water={hindi:'पानी',english:['water'],category:'Lesson 1'};
const attempt=(date,correct=true)=>({...water,date,createdAt:`${date}T12:00:00Z`,mode:'type',correct,close:false});

test('calendar intervals cross DST, year boundaries and leap days without shifting dates',()=>{
  assert.equal(reviewDate('2026-10-24',3),'2026-10-27');
  assert.equal(reviewDate('2026-03-28',3),'2026-03-31');
  assert.equal(reviewDate('2026-12-31',1),'2027-01-01');
  assert.equal(reviewDate('2028-02-28',1),'2028-02-29');
});

test('coach progress deduplicates concepts and includes today without inventing activity',()=>{
  const words={phase1:[water],phase2:[{...water,category:'Lesson 2'}]};
  const attempts={phase1:[attempt('2026-10-19'),attempt('2026-10-20'),attempt('2026-10-23')]};
  const view=learningDashboard(words,attempts,'2026-10-23',['phase1','phase2']);
  assert.equal(view.words.length,1);assert.equal(view.essentials.length,1);assert.equal(view.steady,1);
  assert.equal(view.resting,1);assert.equal(view.themes[0].steady,1);
  assert.equal(view.week.reduce((sum,day)=>sum+day.total,0),3);
  assert.equal(view.week.at(-1).total,1);
  attempts.phase1.push({...attempt('2026-10-23',false),createdAt:'2026-10-23T13:00:00Z'});
  const failed=learningDashboard(words,attempts,'2026-10-23',['phase1','phase2']);
  assert.equal(failed.steady,0);assert.equal(failed.resting,0);assert.equal(failed.difficult.length,1);
});

test('coach is honest about an empty history and limited phase access',()=>{
  const view=learningDashboard({phase1:[water],phase2:[{hindi:'काम करना',english:['work']}]},{},'2026-10-23',['phase1']);
  assert.equal(view.words.length,1);assert.equal(view.started,0);assert.equal(view.steady,0);
  assert.equal(view.week.every(day=>day.total===0),true);assert.equal(view.difficult.length,0);
});
