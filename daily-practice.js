export const DAILY_PHASE_COUNTS = { phase1: 6, phase2: 7, phase3: 7 };

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
    .sort((a,b)=>a.rank-b.rank)
    .map(({word})=>({ ...word, phaseKey }));
}

export function createDailyPractice(wordsByPhase, curriculum, date, phaseKeys=Object.keys(DAILY_PHASE_COUNTS)){
  return phaseKeys.flatMap((phaseKey)=>{
    const words = orderedPhaseWords(wordsByPhase[phaseKey] || [], curriculum[phaseKey]?.words || [], phaseKey);
    const groups = [...new Set(words.map((word)=>word.category))]
      .map((category)=>words.filter((word)=>word.category === category));
    const count = Math.min(DAILY_PHASE_COUNTS[phaseKey] || 0, groups.length);
    return Array.from({length:count},(_,slot)=>{
      const first = Math.floor(slot * groups.length / count);
      const end = Math.floor((slot + 1) * groups.length / count);
      const groupIndex = slot === 0 ? 0 : slot === count - 1 ? groups.length - 1
        : first + dayHash(`${date}|${phaseKey}|group|${slot}`) % (end - first);
      const group = groups[groupIndex];
      return group[dayHash(`${date}|${phaseKey}|word|${slot}`) % group.length];
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
