import { coreTheme, learningKey } from "./core-vocabulary.js?v=20261023-3";

export const DAILY_PHASE_COUNTS = { phase1: 6, phase2: 7, phase3: 7 };
export const DAILY_PLAN_VERSION = 3;
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];

// Calendar arithmetic in UTC avoids shorter/longer days at daylight-saving changes.
export function reviewDate(date, days){
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0,10);
}

function dayHash(value){
  let hash = 2166136261;
  for(const character of value) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return hash >>> 0;
}

function identity(word, phaseKey){
  return word.overrideKey || `${phaseKey}|${word.hindi}|${word.category}`;
}

export function orderedPhaseWords(words, seedWords, phaseKey){
  const order = new Map(seedWords.map((word,index)=>[identity(word, phaseKey), index]));
  const categories = new Map([...new Set(seedWords.map(word=>word.category))].map((category,index)=>[category,index]));
  const seen = new Set();
  return words
    .filter((word)=>{
      if(!word.hindi || !word.english?.length) return false;
      const key = identity(word, phaseKey);
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((word,index)=>({ word, rank:order.get(identity(word, phaseKey)) ?? seedWords.length + index }))
    .sort((a,b)=>(categories.get(a.word.category) ?? categories.size)-(categories.get(b.word.category) ?? categories.size) || a.rank-b.rank)
    .map(({word})=>({ ...word, phaseKey }));
}

export function learningHistory(attemptsByPhase, date, includeToday=false){
  const history = new Map();
  Object.entries(attemptsByPhase || {}).forEach(([phaseKey,attempts])=>{
    (Array.isArray(attempts) ? attempts : []).forEach((attempt)=>{
      const day = attempt.date || String(attempt.createdAt || "").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > date || (!includeToday && day === date) || !attempt.hindi) return;
      const key = learningKey(attempt);
      if(!history.has(key)) history.set(key,[]);
      history.get(key).push({...attempt,date:day,phaseKey});
    });
  });
  return new Map([...history].map(([key,attempts])=>{
    attempts.sort((a,b)=>(a.createdAt || a.date).localeCompare(b.createdAt || b.date));
    const failures = attempts.filter(attempt=>!attempt.correct || attempt.close);
    const failure = failures.at(-1);
    const correct = attempts.filter(attempt=>attempt.correct && !attempt.close);
    const correctDays = new Set(correct.map(attempt=>attempt.date));
    const reviewDays = new Set(correct.filter(attempt=>!failure || attempt.date > failure.date).map(attempt=>attempt.date));
    const successful = correct.filter(attempt=>!failure || attempt.date > failure.date);
    const successDays = new Set(successful.map(attempt=>attempt.date)).size;
    const activeRecall = successful.some(attempt=>attempt.mode === "type" || attempt.mode === "recall");
    const reviewDue = Boolean(failure && reviewDays.size < 2);
    const intervalDays = reviewDue || !activeRecall ? 1 : REVIEW_INTERVALS[Math.min(Math.max(0,successDays-1),REVIEW_INTERVALS.length-1)];
    const lastDate = attempts.at(-1).date;
    const dueAt = reviewDate(lastDate,intervalDays);
    const due = reviewDue || dueAt <= date;
    return [key,{correctDays:correctDays.size,successDays,activeRecall,reviewDue,failure,lastDate,
      intervalDays,dueAt,due,resting:!due,attemptCount:attempts.length,
      wrongCount:failures.length,mastered:successDays >= 3 && activeRecall && !reviewDue}];
  }));
}

// Free practice may include resting words if the learner explicitly requests
// a large set. Its default order still gives difficult and due words priority.
export function prioritisePractice(words, history, random=Math.random){
  return words.map(word=>{
    const stats = history.get(learningKey(word));
    const priority = stats?.reviewDue ? 0 : stats?.due ? 1 : !stats ? 2 : 3;
    return {word,priority,tie:random()};
  }).sort((a,b)=>a.priority-b.priority || a.tie-b.tie).map(item=>item.word);
}

export function createDailyPractice(wordsByPhase, curriculum, date, phaseKeys=Object.keys(DAILY_PHASE_COUNTS), attemptsByPhase={}){
  const history = learningHistory(attemptsByPhase,date);
  const phases = phaseKeys.map(phaseKey=>({phaseKey,words:orderedPhaseWords(wordsByPhase[phaseKey] || [],curriculum[phaseKey]?.words || [],phaseKey)}));
  const allWords = phases.flatMap(phase=>phase.words);
  const reviews = new Map();
  for(const [key,stats] of history){
    if(!stats.reviewDue) continue;
    const matches = allWords.filter(word=>learningKey(word) === key);
    const word = matches.find(word=>word.phaseKey === stats.failure.phaseKey && word.category === stats.failure.category)
      || matches.find(word=>word.phaseKey === stats.failure.phaseKey) || matches[0];
    if(word) reviews.set(key,word);
  }
  const chosen = new Set(reviews.keys());
  return phases.flatMap(({phaseKey,words})=>{
    const selected = [...reviews.values()].filter(word=>word.phaseKey === phaseKey);
    const count = Math.max(DAILY_PHASE_COUNTS[phaseKey] || 0,selected.length);
    const candidates = words.filter(word=>!chosen.has(learningKey(word)) && history.get(learningKey(word))?.resting !== true).map((word,rank)=>{
      const stats = history.get(learningKey(word));
      const core = Boolean(coreTheme(word));
      const priority = stats?.due ? (core ? 0 : 1) : core ? 2 : 3;
      return {word,rank,priority,overdue:stats?.dueAt || date,practised:stats?.successDays || 0,tie:dayHash(`${date}|${phaseKey}|${learningKey(word)}`)};
    }).sort((a,b)=>a.priority-b.priority || a.overdue.localeCompare(b.overdue) || a.practised-b.practised || a.tie-b.tie || a.rank-b.rank);
    for(const {word} of candidates){
      if(selected.length >= count) break;
      const key = learningKey(word);
      if(chosen.has(key)) continue;
      chosen.add(key);
      selected.push(word);
    }
    const order = new Map(words.map((word,index)=>[identity(word,phaseKey),index]));
    return selected.sort((a,b)=>order.get(identity(a,phaseKey))-order.get(identity(b,phaseKey))).map((word)=>{
      const key = learningKey(word);
      const stats = history.get(key);
      const core = Boolean(coreTheme(word));
      return {...word,core,review:reviews.has(key),scheduledReview:Boolean(stats?.due && !reviews.has(key)),practiceMode:phaseKey === "phase1" ? (stats?.correctDays ? "type" : "mc") : phaseKey === "phase2" ? "type" : "recall"};
    });
  });
}

export function mergeDailyPractice(local={}, remote={}){
  const results = {};
  for(const owner of ["maaike", "vincent", "guest"]){
    const candidates = [local?.[owner], remote?.[owner]].filter((result)=>
      result && /^\d{4}-\d{2}-\d{2}$/.test(result.date || "") &&
      Number.isInteger(result.total) && result.total > 0 &&
      Number.isInteger(result.correct) && result.correct >= 0 && result.correct <= result.total
    );
    if(candidates.length) results[owner] = candidates.sort((a,b)=>
      (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date)
    ).at(-1);
  }
  return results;
}
