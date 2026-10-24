import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PHASE3_WORDS} from './phase3-data.js';

const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const app={};vm.createContext(app);
vm.runInContext(source.slice(source.indexOf('function normEnglish('),source.indexOf('const INDEPENDENT_VOWELS')),app);

test('every accepted Lesson 23 alternative is fully correct, including djinn and footstep',()=>{
  const words=PHASE3_WORDS.filter(word=>word.category.endsWith('Lesson 23'));
  assert.ok(words.length>0);
  for(const word of words)for(const answer of word.english){
    const result=app.checkAnswer(answer,word.english);
    assert.equal(result.correct,true,`${word.hindi}: ${answer}`);
    assert.equal(result.close,false,`${answer} must not be penalised as a near miss`);
  }
});

test('an exact alternative wins over a shorter fuzzy match while real typos stay near misses',()=>{
  assert.equal(app.checkAnswer('footstep',['step','footstep']).close,false);
  assert.equal(app.checkAnswer('djinn',['genie','jinn','djinn']).close,false);
  assert.equal(app.checkAnswer('servce',['service']).correct,true);
  assert.equal(app.checkAnswer('servce',['service']).close,true);
  assert.equal(app.checkAnswer('banana',['service']).correct,false);
  assert.equal(app.checkAnswer('',['service']).correct,false);
});
