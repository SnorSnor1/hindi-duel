import { learningHistory, reviewDate } from './daily-practice.js?v=20261023-4';
import { importantWords, learningKey, CORE_THEMES } from './core-vocabulary.js?v=20261023-3';

export function learningDashboard(wordsByPhase, attemptsByPhase, date, phaseKeys){
  const history = learningHistory(attemptsByPhase,date,true);
  const seen = new Set();
  const words = phaseKeys.flatMap(phaseKey=>(wordsByPhase[phaseKey] || []).map(word=>({...word,phaseKey})))
    .filter(word=>{
      const key = learningKey(word);
      if(!word.english?.length || seen.has(key)) return false;
      seen.add(key); return true;
    });
  const statsFor = word=>history.get(learningKey(word));
  const difficult = words.filter(word=>statsFor(word)?.reviewDue).sort((a,b)=>
    statsFor(b).wrongCount-statsFor(a).wrongCount || statsFor(a).lastDate.localeCompare(statsFor(b).lastDate));
  const essentials = importantWords(wordsByPhase,phaseKeys);
  const steady = essentials.filter(word=>statsFor(word)?.mastered).length;
  const started = essentials.filter(word=>statsFor(word)).length;
  const resting = words.filter(word=>statsFor(word)?.resting).length;
  const due = words.filter(word=>statsFor(word)?.due && !statsFor(word)?.reviewDue);
  const themes = CORE_THEMES.map(theme=>{
    const entries = essentials.filter(word=>word.themeLabel===theme.label);
    return {label:theme.label,total:entries.length,steady:entries.filter(word=>statsFor(word)?.mastered).length};
  }).filter(theme=>theme.total);
  const week = Array.from({length:7},(_,index)=>{
    const day = reviewDate(date,index-6);
    const answers = Object.values(attemptsByPhase || {}).flatMap(list=>Array.isArray(list)?list:[])
      .filter(attempt=>(attempt.date || String(attempt.createdAt || '').slice(0,10))===day);
    return {date:day,total:answers.length,correct:answers.filter(attempt=>attempt.correct && !attempt.close).length};
  });
  return {history,words,difficult,essentials,steady,started,resting,due,themes,week};
}
