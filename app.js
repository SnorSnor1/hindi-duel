import { PHASE_DATA } from "./data.js";

const USERS = { maaike: "Maaike10!", vincent: "chailavie" };
const STORE = "hindi.seekho.combined.v1";
const FIREBASE_CONFIG = window.HINDI_DUEL_FIREBASE_CONFIG || null;
const FIREBASE_STATE_PATH = "hindiDuel/sharedState";
const CLOUD_SYNC_ENABLED = Boolean(FIREBASE_CONFIG);
const PHASE1_SHEET_URL = "https://docs.google.com/spreadsheets/d/1cBDf3LfWuA50xTL5N_-A1YUIWmkjWMl9JWJIkq9RYs4/export?format=csv&gid=0";
const PHASE2_SHEET_URL = "https://docs.google.com/spreadsheets/d/14BD6b5P1dCkUB9pouUzWuQsN6woZyNpPOkKihyngKHo/export?format=csv&gid=1937597985";
const DAILY_CHALLENGE_TARGET = 20;
const DAILY_PHASE2_TARGET = 8;
const DAILY_MISTAKE_TARGET = 10;
const DAILY_WEAK_LESSON_TARGET = 8;
const DAILY_FLUENCY_TARGET = 5;
const DAILY_BACKLOG_TARGET = 12;
const CHALLENGE_MISTAKE_LIMIT = 5;
const CHALLENGE_SPACED_LIMIT = 7;
const CHALLENGE_WEAK_LIMIT = 4;
const CHALLENGE_FLUENCY_LIMIT = 4;
const SPACED_REVIEW_TARGET = 12;
const SPACED_REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const FRAGILE_TYPED_MS = 8000;
const FRAGILE_CHOICE_MS = 5000;
const FLUENCY_TARGET_MS = 6000;
const FLUENCY_TIMER_SECONDS = 8;
const WEAK_LESSON_MIN_ATTEMPTS = 4;
const WEAK_LESSON_RATE = 0.32;
const COVERAGE_DAY_TARGET = 2;
const MISTAKE_REPAIR_DAY_TARGET = 2;
const CHALLENGE_REVIEW_MS = 1400;
const PREP_WINDOW_HOURS = 48;
const MAINTENANCE_STALE_DAYS = 7;
const CHALLENGE_RESETS = [
  { id: "2026-05-15-initial-reset", date: "2026-05-15" },
  { id: "2026-05-15-manual-reset-2", date: "2026-05-15" }
];
let state = loadState();
let phase = state.phase || "phase1";
let user = state.user || null;
let selectedCategories = new Set();
let mode = "mixed";
let session = null;
let timer = null;
let activeScreen = "quiz";
let cloudReady = false;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let lastCloudPayload = "";
let firebaseRef = null;
let applyingCloudState = false;
let coachNotice = "";
let nextKeyHandler = null;

const screens = ["coach","quiz","challenge","mistakes","stats","scoreboard","manage","login"];
const $ = (selector) => document.querySelector(selector);
const phaseWordsFor = (phaseKey) => (state.words[phaseKey] || []).filter((word) => word.english.length);
const phaseWords = () => phaseWordsFor(phase);
const categories = () => [...new Set(phaseWords().map((word) => word.category))];
const canUsePhase2 = () => user !== "vincent";

function loadState(){
  const stored = localStorage.getItem(STORE);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const fresh = freshState();
      return applyChallengeResetMigrations({
        ...fresh,
        ...parsed,
        words: {
          phase1: normalizeWordCategories(mergeSeedWords(fresh.words.phase1, parsed.words?.phase1)),
          phase2: normalizeWordCategories(mergeSeedWords(fresh.words.phase2, parsed.words?.phase2))
        },
        scores: {
          maaike: Array.isArray(parsed.scores?.maaike) ? parsed.scores.maaike : [],
          vincent: Array.isArray(parsed.scores?.vincent) ? parsed.scores.vincent : []
        },
        mistakes: {
          maaike: {
            phase1: parsed.mistakes?.maaike?.phase1 || {},
            phase2: parsed.mistakes?.maaike?.phase2 || {}
          },
          vincent: {
            phase1: parsed.mistakes?.vincent?.phase1 || {},
            phase2: parsed.mistakes?.vincent?.phase2 || {}
          }
        },
        attempts: {
          maaike: {
            phase1: Array.isArray(parsed.attempts?.maaike?.phase1) ? parsed.attempts.maaike.phase1 : [],
            phase2: Array.isArray(parsed.attempts?.maaike?.phase2) ? parsed.attempts.maaike.phase2 : []
          },
          vincent: {
            phase1: Array.isArray(parsed.attempts?.vincent?.phase1) ? parsed.attempts.vincent.phase1 : [],
            phase2: Array.isArray(parsed.attempts?.vincent?.phase2) ? parsed.attempts.vincent.phase2 : []
          }
        },
        maintenance: normalizeMaintenance(parsed.maintenance || fresh.maintenance)
      });
    } catch {}
  }
  return applyChallengeResetMigrations(freshState());
}
function mergeSeedWords(seedWords, savedWords){
  const merged = new Map();
  [...normalizeWordCategories(savedWords), ...normalizeWordCategories(seedWords)].forEach((word)=>{
    if(!merged.has(keyFor(word))) merged.set(keyFor(word), word);
  });
  return [...merged.values()];
}
function mergeImportedWords(baseWords, importedWords){
  const merged = new Map((Array.isArray(baseWords) ? baseWords : []).map((word)=>[keyFor(word), word]));
  (Array.isArray(importedWords) ? importedWords : []).forEach((word)=>merged.set(keyFor(word), word));
  return [...merged.values()];
}
function normalizeWordCategories(words){
  return (Array.isArray(words) ? words : []).map(normalizeWordEntry);
}
function normalizeWordEntry(word){
  const normalized = { ...word, category: cleanCategoryName(word.category) };
  if(normalized.category === "Lesson 1b" && normHindi(normalized.hindi) === "जमुनी") normalized.hindi = "जामुनी";
  if(normalized.category === "Lesson 1b" && normHindi(normalized.hindi) === "पूल") normalized.english = ["bridge"];
  return normalized;
}
function freshState(){
  return {
    phase: "phase1",
    user: null,
    words: { phase1: PHASE_DATA.phase1.words, phase2: PHASE_DATA.phase2.words },
    scores: { maaike: [], vincent: [] },
    mistakes: { maaike: { phase1: {}, phase2: {} }, vincent: { phase1: {}, phase2: {} } },
    attempts: { maaike: { phase1: [], phase2: [] }, vincent: { phase1: [], phase2: [] } },
    maintenance: emptyMaintenance(),
    challengeResets: []
  };
}
function emptyMaintenance(){
  return {
    phase1: { lastSyncedAt: null, lastCount: PHASE_DATA.phase1.words.length },
    phase2: { lastSyncedAt: null, lastCount: PHASE_DATA.phase2.words.length },
    lessonPrep: { nextLessonAt: "", checkedAt: null, note: "" }
  };
}
function normalizeMaintenance(value={}){
  const fresh = emptyMaintenance();
  return {
    phase1: { ...fresh.phase1, ...(value.phase1 || {}) },
    phase2: { ...fresh.phase2, ...(value.phase2 || {}) },
    lessonPrep: { ...fresh.lessonPrep, ...(value.lessonPrep || {}) }
  };
}
function newestByTime(a={}, b={}){
  const aTime = a.updatedAt || a.checkedAt || a.lastSyncedAt || "";
  const bTime = b.updatedAt || b.checkedAt || b.lastSyncedAt || "";
  return bTime > aTime ? b : a;
}
function mergeMaintenance(local={}, remote={}){
  const base = normalizeMaintenance(local);
  const incoming = normalizeMaintenance(remote);
  return {
    phase1: newestByTime(base.phase1, incoming.phase1),
    phase2: newestByTime(base.phase2, incoming.phase2),
    lessonPrep: newestByTime(base.lessonPrep, incoming.lessonPrep)
  };
}
function applyChallengeResetMigrations(nextState){
  nextState.challengeResets = Array.isArray(nextState.challengeResets) ? nextState.challengeResets : [];
  nextState.maintenance = normalizeMaintenance(nextState.maintenance);
  CHALLENGE_RESETS.forEach((reset)=>{
    const id = typeof reset === "string" ? reset : reset.id;
    const date = typeof reset === "string" ? reset : reset.date;
    if(nextState.challengeResets.includes(id)) return;
    ["maaike","vincent"].forEach((name)=>{
      if(!Array.isArray(nextState.scores?.[name])) return;
      nextState.scores[name] = nextState.scores[name].filter((score)=>!(score.date===date && score.phase==="phase1"));
    });
    nextState.challengeResets.push(id);
  });
  return nextState;
}
function save(options={}){
  state.phase = phase;
  state.user = user;
  localStorage.setItem(STORE, JSON.stringify(state));
  if(options.sync === false) return;
  if(options.immediate) pushCloudState();
  else scheduleCloudSave();
}
function sharedState(){
  return {
    version: 1,
    scores: state.scores,
    mistakes: state.mistakes,
    attempts: state.attempts,
    maintenance: state.maintenance,
    challengeResets: state.challengeResets
  };
}
function mergeScores(local=[], remote=[]){
  const merged = new Map();
  [...local, ...remote].forEach((score)=>{
    if(!score || !score.date || !score.phase) return;
    const key = `${score.phase}|${score.date}`;
    const previous = merged.get(key);
    const previousTime = previous?.updatedAt || previous?.createdAt || "";
    const scoreTime = score.updatedAt || score.createdAt || "";
    if(!previous || scoreTime >= previousTime || (score.completed && !previous.completed)) merged.set(key, score);
  });
  return [...merged.values()].sort((a,b)=>(a.createdAt || a.date).localeCompare(b.createdAt || b.date));
}
function mergeAttempts(local=[], remote=[]){
  const merged = new Map();
  [...local, ...remote].forEach((attempt)=>{
    if(!attempt) return;
    const id = attempt.id || `${attempt.date}|${attempt.hindi}|${attempt.answer}|${attempt.createdAt || ""}`;
    merged.set(id, attempt);
  });
  return [...merged.values()].sort((a,b)=>(a.createdAt || a.date || "").localeCompare(b.createdAt || b.date || "")).slice(-2500);
}
function latestMistake(a={}, b={}){
  const aTime = a.lastCorrectAt || a.lastWrongAt || "";
  const bTime = b.lastCorrectAt || b.lastWrongAt || "";
  if(bTime > aTime) return b;
  if(aTime > bTime) return a;
  return (b.count || 0) >= (a.count || 0) ? b : a;
}
function mergeMistakeBucket(local={}, remote={}){
  const merged = { ...local };
  Object.entries(remote || {}).forEach(([key,value])=>{
    merged[key] = merged[key] ? latestMistake(merged[key], value) : value;
  });
  return merged;
}
function mergeCloudState(remote){
  if(!remote || typeof remote !== "object") return;
  ["maaike","vincent"].forEach((name)=>{
    state.scores[name] = mergeScores(state.scores[name], remote.scores?.[name]);
    ["phase1","phase2"].forEach((phaseKey)=>{
      state.attempts[name][phaseKey] = mergeAttempts(state.attempts[name][phaseKey], remote.attempts?.[name]?.[phaseKey]);
      state.mistakes[name][phaseKey] = mergeMistakeBucket(state.mistakes[name][phaseKey], remote.mistakes?.[name]?.[phaseKey]);
    });
  });
  state.challengeResets = [...new Set([...(state.challengeResets || []), ...(remote.challengeResets || [])])];
  state.maintenance = mergeMaintenance(state.maintenance, remote.maintenance);
  applyChallengeResetMigrations(state);
}
function rerenderCloudSensitiveScreen(){
  if(session) return;
  if(activeScreen === "coach") renderCoach();
  if(activeScreen === "challenge") renderChallenge();
  if(activeScreen === "scoreboard") renderScoreboard();
  if(activeScreen === "stats") renderStats();
  if(activeScreen === "mistakes") renderMistakes();
}
async function initCloudSync(){
  if(!CLOUD_SYNC_ENABLED) return false;
  if(!window.firebase?.initializeApp || !window.firebase?.database){
    console.warn("Firebase SDK unavailable; shared scores are disabled.");
    return false;
  }
  try {
    if(!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
    if(window.firebase.auth){
      try {
        const auth = window.firebase.auth();
        if(!auth.currentUser) await auth.signInAnonymously();
      } catch (error) {
        console.warn("Firebase anonymous auth unavailable; trying database without auth.", error);
      }
    }
    firebaseRef = window.firebase.database().ref(FIREBASE_STATE_PATH);
    firebaseRef.on("value",(snapshot)=>{
      const remote = snapshot.val();
      applyingCloudState = true;
      mergeCloudState(remote);
      cloudReady = true;
      save({ sync:false });
      lastCloudPayload = JSON.stringify(remote || {});
      if(user) rerenderCloudSensitiveScreen();
      applyingCloudState = false;
      scheduleCloudSave();
    },(error)=>{
      console.warn("Firebase shared state unavailable", error);
    });
    return true;
  } catch (error) {
    console.warn("Firebase setup failed", error);
    return false;
  }
}
async function loadCloudState(options={}){
  if(!CLOUD_SYNC_ENABLED) return false;
  if(!firebaseRef) return false;
  try {
    const snapshot = await firebaseRef.get();
    const remote = snapshot.val();
    applyingCloudState = true;
    mergeCloudState(remote);
    cloudReady = true;
    save({ sync:false });
    lastCloudPayload = JSON.stringify(remote || {});
    if(options.rerender) rerenderCloudSensitiveScreen();
    applyingCloudState = false;
    scheduleCloudSave();
    return true;
  } catch (error) {
    applyingCloudState = false;
    console.warn("Firebase shared state unavailable", error);
    return false;
  }
}
function scheduleCloudSave(){
  if(!CLOUD_SYNC_ENABLED) return;
  if(applyingCloudState) return;
  if(!cloudReady) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(pushCloudState, 700);
}
async function pushCloudState(){
  if(!CLOUD_SYNC_ENABLED) return;
  if(!firebaseRef || !cloudReady || applyingCloudState || cloudSaveInFlight) return;
  const payload = JSON.stringify(sharedState());
  if(payload === lastCloudPayload) return;
  cloudSaveInFlight = true;
  try {
    await firebaseRef.set(JSON.parse(payload));
    lastCloudPayload = payload;
  } catch (error) {
    console.warn("Firebase shared state save failed", error);
  } finally {
    cloudSaveInFlight = false;
  }
}
function shuffle(items){ for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];} return items; }
function normEnglish(value){ return String(value||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s]/g," ").replace(/\b(to|a|an|the)\b/g," ").replace(/\s+/g," ").trim(); }
function normHindi(value){ return String(value||"").normalize("NFC").replace(/[़]/g,"").replace(/\s+/g," ").trim(); }
function levenshtein(a,b){ const m=Array.from({length:b.length+1},(_,r)=>[r]); for(let c=0;c<=a.length;c++)m[0][c]=c; for(let r=1;r<=b.length;r++){for(let c=1;c<=a.length;c++){m[r][c]=b[r-1]===a[c-1]?m[r-1][c-1]:Math.min(m[r-1][c-1]+1,m[r][c-1]+1,m[r-1][c]+1)}} return m[b.length][a.length]; }
function checkAnswer(answer, accepted){ const a=normEnglish(answer); if(!a)return {correct:false,close:false}; for(const value of accepted){ const b=normEnglish(value); if(a===b)return {correct:true,close:false}; const limit=Math.max(1,Math.ceil(b.length*.18)); if(levenshtein(a,b)<=limit || b.includes(a) || a.includes(b)) return {correct:true,close:true}; } return {correct:false,close:false}; }
const INDEPENDENT_VOWELS = { अ:"a", आ:"aa", इ:"i", ई:"ee", उ:"u", ऊ:"oo", ऋ:"ri", ए:"e", ऐ:"ai", ओ:"o", औ:"au", ऑ:"o", ऍ:"e" };
const VOWEL_SIGNS = { "ा":"aa", "ि":"i", "ी":"ee", "ु":"u", "ू":"oo", "ृ":"ri", "े":"e", "ै":"ai", "ो":"o", "ौ":"au", "ॉ":"o", "ॅ":"e" };
const CONSONANTS = { क:"k", ख:"kh", ग:"g", घ:"gh", ङ:"ng", च:"ch", छ:"chh", ज:"j", झ:"jh", ञ:"ny", ट:"t", ठ:"th", ड:"d", ढ:"dh", ण:"n", त:"t", थ:"th", द:"d", ध:"dh", न:"n", प:"p", फ:"ph", ब:"b", भ:"bh", म:"m", य:"y", र:"r", ल:"l", व:"v", श:"sh", ष:"sh", स:"s", ह:"h", ळ:"l" };
const NUKTA_CONSONANTS = { क:"q", ख:"kh", ग:"gh", ज:"z", ड:"d", ढ:"dh", फ:"f", य:"y" };
const DEVANAGARI_DIGITS = { "०":"0", "१":"1", "२":"2", "३":"3", "४":"4", "५":"5", "६":"6", "७":"7", "८":"8", "९":"9" };
function romanizeWordEnd(value){
  return value
    .replace(/([bcdfghjklmnpqrstvwxyz])a\b/gi, "$1")
    .replace(/aa\b/g, "aa");
}
function romanizeHindi(value){
  const chars = [...String(value || "").normalize("NFC")];
  let output = "";
  for(let i=0;i<chars.length;i++){
    const char = chars[i];
    const next = chars[i + 1];
    const afterNext = chars[i + 2];
    if(CONSONANTS[char]){
      const base = next === "़" && NUKTA_CONSONANTS[char] ? NUKTA_CONSONANTS[char] : CONSONANTS[char];
      if(next === "़") i++;
      const following = chars[i + 1];
      output += base;
      if(following === "्"){ i++; continue; }
      if(VOWEL_SIGNS[following]){ output += VOWEL_SIGNS[following]; i++; continue; }
      if(following === "़" && VOWEL_SIGNS[afterNext]){ output += VOWEL_SIGNS[afterNext]; i += 2; continue; }
      output += "a";
      continue;
    }
    if(INDEPENDENT_VOWELS[char]){ output += INDEPENDENT_VOWELS[char]; continue; }
    if(VOWEL_SIGNS[char]){ output += VOWEL_SIGNS[char]; continue; }
    if(char === "ं" || char === "ँ"){ output += "n"; continue; }
    if(char === "ः"){ output += "h"; continue; }
    if(char === "्" || char === "़"){ continue; }
    output += DEVANAGARI_DIGITS[char] || char;
  }
  return output.split(/(\s+)/).map((part)=>/\s+/.test(part) ? part : romanizeWordEnd(part)).join("").replace(/\s+/g," ").trim();
}
function cleanCategoryName(value){
  const raw = String(value || "Imported").replace(/\s+/g," ").trim() || "Imported";
  const withoutSetPrefix = raw.replace(/^(set|groep|group)\s*\d+\s*[-–—:.)]?\s*/i, "").trim();
  const withoutSetSuffix = withoutSetPrefix.replace(/\s*[-–—:.(]?\s*(set|groep|group)\s*\d+\)?\s*$/i, "").trim();
  if(withoutSetSuffix) return withoutSetSuffix;
  return raw.replace(/^(set|groep|group)\s*/i, "Lesson ");
}
function displayCategory(value){ return cleanCategoryName(value); }
function isVerbWord(word){
  const hindi = normHindi(word?.hindi || "");
  return /ना$|करना|होना|आना|जाना|लेना|देना|लगना|लगाना|मचना/.test(hindi);
}
function formatEnglishAnswer(word, value){
  const answer = String(value || "").trim();
  if(!answer || !isVerbWord(word)) return answer;
  if(/^\(to\)\s*/i.test(answer)) return answer.replace(/^\(to\)\s*/i, "(to) ");
  return `(to) ${answer.replace(/^to\s+/i, "")}`;
}
function formatEnglishList(word){ return word.english.map((answer)=>formatEnglishAnswer(word, answer)).join("; "); }
function formatPrimaryEnglish(word){ return formatEnglishAnswer(word, word.english[0] || ""); }
function romanizedHindiHtml(word){
  const roman = romanizeHindi(word?.hindi || "");
  return roman ? `<small class="romanized-hindi">${escapeHtml(roman)}</small>` : "";
}
function today(value=new Date()){
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function displayDate(date){
  const [year, month, day] = String(date || "").slice(0,10).split("-");
  return day && month ? `${day}/${month}` : String(date || "");
}
function weekKey(value=new Date()){
  const date = new Date(value);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (utcDate.getUTCDay() + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - day);
  return utcDate.toISOString().slice(0,10);
}
function attemptWeek(attempt){ return weekKey(attempt.date || attempt.createdAt || new Date()); }
function keyFor(word){ return word.hindi + "|" + word.category; }
function wordSessionKey(word){ return `${word.phaseKey || ""}|${keyFor(word)}`; }
function escapeHtml(value){ return String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
function categoryForPhase1Row(row){
  const ranges = [
    [2,9,"People"],[10,25,"Animals"],[26,32,"Pronouns"],[33,42,"Movement verbs"],[43,66,"Kitchenware and furniture"],[67,74,"Positions"],[75,82,"Basic actions"],[83,106,"Room and classroom items"],[107,118,"Kitchen items"],[119,130,"More animals"],[131,147,"Everyday objects"],[148,193,"Body and animal parts"],[194,217,"Family"],[218,225,"Possessives"],[226,228,"Touch and washing"],[229,239,"Colours"],[240,247,"Drinks"],[248,289,"Food and cooking"],[290,314,"Clothes and accessories"],[315,324,"Daily actions"],[325,343,"Feelings and needs"],[344,347,"Speaking phrases"],[348,360,"Tools"],[361,364,"Hitting and feeding verbs"],[365,369,"Small creatures"],[370,389,"Numbers 1-100"],[390,399,"Ordinal numbers"],[400,415,"World and directions"],[416,427,"Money"],[428,454,"Nature and travel"],[455,485,"Bathroom and cleaning"],[486,545,"Places in town"],[546,576,"Action verbs and devices"],[577,616,"Numbers 11-50"],[617,629,"Question words"],[630,644,"Books and reading"],[645,648,"Small animals and objects"],[649,663,"Heights and lines"],[664,670,"Shapes and distance"],[671,691,"Quantities and comparisons"],[692,711,"Numbers 71-90"],[712,713,"Life stages"],[714,738,"Rooms and household items"],[739,739,"Birthday phrase"],[740,757,"Water and states"],[758,774,"Numbers 91-1000"],[775,791,"Time and weekdays"],[792,803,"Months"],[804,817,"Weather"]
  ];
  return ranges.find(([start,end])=>row>=start&&row<=end)?.[2] || "Imported";
}
function parseCsv(text){
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = ""; continue;
    }
    cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function cacheBustedUrl(url){
  return `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`;
}
function splitAnswers(...values){
  return values.flatMap((value)=>String(value || "").split(/[;,/]/)).map((item)=>item.trim()).filter(Boolean);
}
async function fetchPhase1WordsFromSheet(){
  const response = await fetch(cacheBustedUrl(PHASE1_SHEET_URL), { cache: "no-store" });
  if (!response.ok) throw new Error("Phase 1 Sheet is not accessible.");
  const rows = parseCsv(await response.text()).slice(1);
  return rows.map((cells,index)=>({
    hindi: String(cells[0] || "").replace(/\s+/g," ").trim(),
    english: String(cells[1] || "").split(";").map((item)=>item.trim()).filter(Boolean),
    category: categoryForPhase1Row(index + 2)
  })).filter((word)=>word.hindi && word.english.length);
}
async function fetchPhase2WordsFromSheet(){
  const response = await fetch(cacheBustedUrl(PHASE2_SHEET_URL), { cache: "no-store" });
  if (!response.ok) throw new Error("Phase 2 Sheet is not accessible.");
  const rows = parseCsv(await response.text());
  if(!rows.length) return [];
  const header = rows[0].map((cell)=>normEnglish(cell));
  const categoryIndex = header.findIndex((cell)=>cell.includes("category"));
  const lessonIndex = header.findIndex((cell)=>cell.includes("lesson"));
  const hindiIndex = header.findIndex((cell)=>cell.includes("hindi"));
  const englishIndex = header.findIndex((cell)=>cell.includes("english"));
  const synonymIndex = header.findIndex((cell)=>cell.includes("synonym"));
  if(hindiIndex < 0 || englishIndex < 0) return [];
  return rows.slice(1).map((cells)=>({
    hindi: String(cells[hindiIndex] || "").replace(/\s+/g," ").trim(),
    english: splitAnswers(cells[englishIndex], synonymIndex >= 0 ? cells[synonymIndex] : ""),
    category: cleanCategoryName((categoryIndex >= 0 ? cells[categoryIndex] : "") || (lessonIndex >= 0 ? cells[lessonIndex] : "") || "Imported")
  })).filter((word)=>word.hindi && word.english.length);
}
async function syncPhase1FromSheet(status = $("#syncStatus")){
  if(status) status.textContent = "Syncing...";
  let words = [];
  try {
    words = await fetchPhase1WordsFromSheet();
  } catch {
    if(status) status.textContent = "Sync failed. Check whether the Google Sheet is accessible.";
    return;
  }
  state.words.phase1 = words;
  state.maintenance = normalizeMaintenance(state.maintenance);
  state.maintenance.phase1 = { lastSyncedAt: new Date().toISOString(), lastCount: words.length, updatedAt: new Date().toISOString() };
  phase = "phase1";
  selectedCategories = new Set(categories());
  save();
  if(status) status.textContent = `Synced ${words.length} Phase 1 words from Google Sheet.`;
  if(activeScreen === "manage") renderManage();
  if(activeScreen === "coach") renderCoach();
}
async function syncPhase2FromSheet(status = $("#syncStatus")){
  if(status) status.textContent = "Syncing...";
  let words = [];
  try {
    words = await fetchPhase2WordsFromSheet();
  } catch {
    if(status) status.textContent = "Sync failed. Check whether the Google Sheet is accessible.";
    return;
  }
  state.words.phase2 = mergeImportedWords(PHASE_DATA.phase2.words, words);
  state.maintenance = normalizeMaintenance(state.maintenance);
  state.maintenance.phase2 = { lastSyncedAt: new Date().toISOString(), lastCount: state.words.phase2.length, importedRows: words.length, updatedAt: new Date().toISOString() };
  phase = "phase2";
  selectedCategories = new Set(categories());
  save();
  if(status) status.textContent = words.length
    ? `Synced ${words.length} Sheet rows. Phase 2 now has ${state.words.phase2.length} words.`
    : `The Sheet has no word rows yet. Kept ${state.words.phase2.length} built-in Phase 2 words.`;
  if(activeScreen === "manage") renderManage();
  if(activeScreen === "coach") renderCoach();
}
async function autoSyncPublishedSheets(){
  const [phase1Result, phase2Result] = await Promise.allSettled([
    fetchPhase1WordsFromSheet(),
    fetchPhase2WordsFromSheet()
  ]);
  let changed = false;
  const now = new Date().toISOString();

  if(phase1Result.status === "fulfilled" && phase1Result.value.length){
    state.words.phase1 = phase1Result.value;
    state.maintenance = normalizeMaintenance(state.maintenance);
    state.maintenance.phase1 = { lastSyncedAt: now, lastCount: phase1Result.value.length, updatedAt: now };
    changed = true;
  }

  if(phase2Result.status === "fulfilled" && phase2Result.value.length){
    state.words.phase2 = mergeImportedWords(PHASE_DATA.phase2.words, phase2Result.value);
    state.maintenance = normalizeMaintenance(state.maintenance);
    state.maintenance.phase2 = { lastSyncedAt: now, lastCount: state.words.phase2.length, importedRows: phase2Result.value.length, updatedAt: now };
    changed = true;
  }

  if(!changed) return;
  selectedCategories = new Set(categories());
  save();
  if(session) return;
  if(activeScreen === "coach") renderCoach();
  if(activeScreen === "quiz") renderQuizSetup();
  if(activeScreen === "manage") renderManage();
  if(activeScreen === "mistakes") renderMistakes();
  if(activeScreen === "stats") renderStats();
  if(activeScreen === "scoreboard") renderScoreboard();
}

function show(screen){
  if(!canUsePhase2() && phase==="phase2") phase = "phase1";
  const gatedScreens = ["mistakes","stats","scoreboard"];
  if(user && gatedScreens.includes(screen) && !dailyContractFor(user).complete){
    coachNotice = "Finish today's contract first. Stats, scoreboard and mistake browsing unlock after the daily work is done.";
    screen = "coach";
  } else {
    coachNotice = "";
  }
  activeScreen = screen;
  screens.forEach((id)=>$("#"+id).classList.toggle("hidden", id!==screen));
  document.querySelectorAll("[data-screen]").forEach((button)=>button.classList.toggle("active", button.dataset.screen===screen));
  if(screen==="coach") renderCoach();
  if(screen==="quiz") renderQuizSetup();
  if(screen==="challenge") renderChallenge();
  if(screen==="mistakes") renderMistakes();
  if(screen==="stats") renderStats();
  if(screen==="scoreboard") renderScoreboard();
  if(screen==="manage") renderManage();
  if(user && ["coach","challenge","scoreboard","stats","mistakes"].includes(screen)) loadCloudState({ rerender:true });
}
function renderNav(){
  const logged = Boolean(user);
  document.querySelectorAll(".private").forEach((el)=>el.classList.toggle("hidden", !logged));
  document.querySelectorAll(".maaike").forEach((el)=>el.classList.toggle("hidden", user!=="maaike"));
  $("#loginBtn").classList.toggle("hidden", logged);
  $("#logoutBtn").classList.toggle("hidden", !logged);
}
function phaseToggleHtml(){
  if (!canUsePhase2()) return `<div class="phase-toggle"><button class="selected" data-phase="phase1">Phase 1</button></div>`;
  return `<div class="phase-toggle"><button class="${phase==="phase1"?"selected":""}" data-phase="phase1">Phase 1</button><button class="${phase==="phase2"?"selected":""}" data-phase="phase2">Phase 2</button></div>`;
}
function bindPhaseButtons(){ document.querySelectorAll("[data-phase]").forEach((button)=>button.addEventListener("click",()=>{phase=button.dataset.phase; if(!canUsePhase2() && phase==="phase2") phase="phase1"; selectedCategories=new Set(categories()); save(); show(activeScreen);})); }
function renderCategoryChips(){
  const counts = Object.fromEntries(categories().map((cat)=>[cat, phaseWords().filter((word)=>word.category===cat).length]));
  return `<div class="category-chips">${categories().map((cat)=>`<button type="button" class="cat-chip ${selectedCategories.has(cat)?"selected":""}" data-cat="${escapeAttr(cat)}">${escapeHtml(displayCategory(cat))} <span class="count">${counts[cat]}</span></button>`).join("")}</div>`;
}
function escapeAttr(value){ return String(value).replace(/"/g,"&quot;"); }
function bindCategoryChips(){
  document.querySelectorAll("[data-cat]").forEach((button)=>{
    button.addEventListener("click",()=>{ const cat=button.dataset.cat; selectedCategories.has(cat)?selectedCategories.delete(cat):selectedCategories.add(cat); if(!selectedCategories.size) selectedCategories=new Set(categories()); updateCategoryChipStates(); });
    button.addEventListener("dblclick",()=>{ selectedCategories=new Set([button.dataset.cat]); updateCategoryChipStates(); });
  });
}
function updateCategoryChipStates(){
  document.querySelectorAll("[data-cat]").forEach((button)=>button.classList.toggle("selected", selectedCategories.has(button.dataset.cat)));
}
function todaysChallengeScore(name=user){
  return name ? (state.scores[name] || []).filter((score)=>score.date===today() && score.phase==="phase1").at(-1) || null : null;
}
function lockChallengeNavigation(){
  if(!session || session.source!=="challenge") return;
  window.history.pushState({ challengeLocked:true }, "", window.location.pathname);
}
function createChallengeScore(total){
  const score = { phase:"phase1", date:today(), correct:0, total, approved:0, completed:false, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  state.scores[user].push(score);
  save();
  return score;
}
function updateChallengeScore(completed=false){
  if(!user || !session || session.source!=="challenge") return;
  const score = session.score || todaysChallengeScore();
  if(!score) return;
  score.correct = session.correct;
  score.total = session.queue.length;
  score.approved = session.approved;
  score.completed = Boolean(completed);
  score.updatedAt = new Date().toISOString();
  save();
}
function attemptsFor(name, phaseKey){
  return state.attempts[name]?.[phaseKey] || [];
}
function attemptsToday(name, phaseKey){
  const date = today();
  return attemptsFor(name, phaseKey).filter((attempt)=>attempt.date===date);
}
function allAttemptsToday(name){
  return ["phase1","phase2"].flatMap((phaseKey)=>attemptsToday(name, phaseKey).map((attempt)=>({ ...attempt, phaseKey })));
}
function correctAttemptsToday(name, predicate=()=>true){
  return allAttemptsToday(name).filter((attempt)=>attempt.correct && predicate(attempt)).length;
}
function correctTypedWordKeysToday(name, phaseKey, predicate=()=>true){
  return new Set(attemptsToday(name, phaseKey)
    .filter((attempt)=>attempt.correct && attempt.mode==="type" && predicate(attempt))
    .map((attempt)=>`${attempt.hindi}|${attempt.category}`));
}
function activeMistakesFor(name, phaseKey){
  return Object.values(state.mistakes[name]?.[phaseKey] || {}).filter((word)=>word.hindi && word.english?.length);
}
function allActiveMistakes(name){
  return ["phase1","phase2"].flatMap((phaseKey)=>activeMistakesFor(name, phaseKey).map((word)=>({ ...word, phaseKey })));
}
function uniqueWords(words){
  const map = new Map();
  (Array.isArray(words) ? words : []).forEach((word)=>{
    if(word?.hindi && word?.english?.length) map.set(wordSessionKey(word), word);
  });
  return [...map.values()];
}
function sessionMissedWords(value){
  return uniqueWords(Object.values(value?.missed || {}));
}
function dateValue(date){
  const [year, month, day] = String(date || "").slice(0,10).split("-").map(Number);
  if(!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getTime();
}
function addDays(date, days){
  const base = dateValue(date);
  if(!base) return today();
  const next = new Date(base + days * 86400000);
  return today(next);
}
function wordPhaseKey(word){
  return word?.phaseKey || session?.phaseKey || phase;
}
function attemptsForWord(name, phaseKey, word){
  return attemptsFor(name, phaseKey)
    .filter((attempt)=>attempt.hindi === word.hindi && attempt.category === word.category)
    .sort((a,b)=>(a.createdAt || a.date || "").localeCompare(b.createdAt || b.date || ""));
}
function attemptDate(attempt){
  return attempt?.date || (attempt?.createdAt || "").slice(0,10);
}
function repairDayCount(word){
  return new Set(Array.isArray(word?.repairDays) ? word.repairDays.filter(Boolean) : []).size;
}
function reviewStatsForWord(name, phaseKey, word){
  const attempts = attemptsForWord(name, phaseKey, word);
  if(!attempts.length) return null;
  const wrongCount = attempts.filter((attempt)=>!attempt.correct).length;
  const lastWrongIndex = attempts.reduce((last, attempt, index)=>attempt.correct ? last : index, -1);
  const recentCorrect = attempts.slice(lastWrongIndex + 1).filter((attempt)=>attempt.correct);
  const lastCorrect = recentCorrect.at(-1);
  if(!lastCorrect) return null;
  const typedCorrect = recentCorrect.filter((attempt)=>attempt.mode === "type");
  const correctStreak = typedCorrect.length;
  const lastTypedCorrect = typedCorrect.at(-1);
  const recognitionOnly = !lastTypedCorrect;
  const fragile = recognitionOnly || Boolean(lastTypedCorrect.close || (lastTypedCorrect.ms || 0) > FRAGILE_TYPED_MS);
  const interval = recognitionOnly ? 1 : fragile ? 1 : SPACED_REVIEW_INTERVALS[Math.min(correctStreak - 1, SPACED_REVIEW_INTERVALS.length - 1)];
  const reviewedAt = attemptDate(lastTypedCorrect || lastCorrect);
  const dueAt = addDays(reviewedAt, interval);
  return { correctStreak, wrongCount, reviewedAt, dueAt, fragile, recognitionOnly, overdueDays: Math.max(0, Math.floor((dateValue(today()) - dateValue(dueAt)) / 86400000)) };
}
function spacedReviewWords(name){
  if(!name) return [];
  return ["phase1","phase2"].flatMap((phaseKey)=>{
    const mistakeKeys = new Set(activeMistakesFor(name, phaseKey).map(keyFor));
    return phaseWordsFor(phaseKey)
      .filter((word)=>!mistakeKeys.has(keyFor(word)))
      .map((word)=>({ ...word, phaseKey, review: reviewStatsForWord(name, phaseKey, word) }))
      .filter((word)=>word.review && dateValue(word.review.dueAt) <= dateValue(today()));
  }).sort((a,b)=>
    dateValue(a.review.dueAt) - dateValue(b.review.dueAt) ||
    b.review.wrongCount - a.review.wrongCount ||
    a.review.correctStreak - b.review.correctStreak
  );
}
function coverageWords(name, phaseKey, count=DAILY_PHASE2_TARGET){
  if(!name) return [];
  const latest = new Set(phaseKey==="phase2" ? phase2PrepCategories(4) : latestPhaseCategories(phaseKey, 4));
  const mistakeKeys = new Set(activeMistakesFor(name, phaseKey).map(keyFor));
  return phaseWordsFor(phaseKey)
    .filter((word)=>!mistakeKeys.has(keyFor(word)))
    .map((word)=>{
      const attempts = attemptsForWord(name, phaseKey, word);
      const typedCorrectAttempts = attempts.filter((attempt)=>attempt.correct && attempt.mode === "type");
      const typedCorrect = typedCorrectAttempts.length;
      const typedDays = new Set(typedCorrectAttempts.map(attemptDate).filter(Boolean));
      const totalCorrect = attempts.filter((attempt)=>attempt.correct).length;
      const last = attempts.at(-1);
      const missing = Math.max(0, COVERAGE_DAY_TARGET - typedDays.size);
      const priority = missing * 180 + (latest.has(word.category) ? 90 : 0) + (!attempts.length ? 55 : 0) + (!last?.correct ? 35 : 0) + Math.max(0, 6 - totalCorrect);
      return { ...word, phaseKey, coverage:{ typedCorrect, typedDays:typedDays.size, totalCorrect, attempts:attempts.length, missing, priority, latest:latest.has(word.category) } };
    })
    .filter((word)=>word.coverage.missing > 0)
    .sort((a,b)=>
      b.coverage.priority - a.coverage.priority ||
      a.coverage.typedDays - b.coverage.typedDays ||
      a.coverage.typedCorrect - b.coverage.typedCorrect ||
      a.coverage.attempts - b.coverage.attempts
    )
    .slice(0, count);
}
function weakLessonStats(name){
  if(!name) return [];
  const activeCounts = new Map(allActiveMistakes(name).map((word)=>[`${word.phaseKey}|${word.category}`, 0]));
  allActiveMistakes(name).forEach((word)=>{
    const key = `${word.phaseKey}|${word.category}`;
    activeCounts.set(key, (activeCounts.get(key) || 0) + 1);
  });
  const groups = new Map();
  ["phase1","phase2"].forEach((phaseKey)=>{
    attemptsFor(name, phaseKey).forEach((attempt)=>{
      const key = `${phaseKey}|${attempt.category}`;
      if(!groups.has(key)) groups.set(key, { phaseKey, category:attempt.category, attempts:0, wrong:0, fragile:0, activeMistakes:activeCounts.get(key) || 0 });
      const group = groups.get(key);
      group.attempts++;
      if(!attempt.correct) group.wrong++;
      if(attempt.correct && (attempt.close || ((attempt.ms || 0) > (attempt.mode === "mc" ? FRAGILE_CHOICE_MS : FRAGILE_TYPED_MS)))) group.fragile++;
    });
  });
  activeCounts.forEach((count, key)=>{
    if(groups.has(key)) return;
    const [phaseKey, category] = key.split("|");
    groups.set(key, { phaseKey, category, attempts:0, wrong:0, fragile:0, activeMistakes:count });
  });
  return [...groups.values()]
    .map((group)=>{
      const weakLoad = group.wrong + group.fragile * 0.5 + group.activeMistakes * 1.25;
      const rate = group.attempts ? weakLoad / group.attempts : group.activeMistakes ? 1 : 0;
      return { ...group, weakLoad, rate, score:rate * 100 + group.activeMistakes * 18 + group.wrong * 6 + group.fragile * 3 };
    })
    .filter((group)=>group.activeMistakes >= 2 || (group.attempts >= WEAK_LESSON_MIN_ATTEMPTS && group.rate >= WEAK_LESSON_RATE))
    .sort((a,b)=>b.score-a.score || b.weakLoad-a.weakLoad || b.attempts-a.attempts)
    .slice(0, 2);
}
function weakLessonWords(name, count=DAILY_WEAK_LESSON_TARGET){
  const lessons = weakLessonStats(name);
  if(!lessons.length) return [];
  const lessonKeys = new Set(lessons.map((lesson)=>`${lesson.phaseKey}|${lesson.category}`));
  const doneToday = new Set(allAttemptsToday(name).filter((attempt)=>attempt.source==="coach-weak" && attempt.correct).map((attempt)=>`${attempt.phaseKey}|${attempt.hindi}|${attempt.category}`));
  const activeKeys = new Set(allActiveMistakes(name).map((word)=>`${word.phaseKey}|${keyFor(word)}`));
  const dueKeys = new Set(spacedReviewWords(name).map((word)=>`${word.phaseKey}|${keyFor(word)}`));
  const words = ["phase1","phase2"].flatMap((phaseKey)=>
    phaseWordsFor(phaseKey)
      .filter((word)=>lessonKeys.has(`${phaseKey}|${word.category}`))
      .filter((word)=>!doneToday.has(`${phaseKey}|${word.hindi}|${word.category}`))
      .map((word)=>{
        const key = `${phaseKey}|${keyFor(word)}`;
        const attempts = attemptsForWord(name, phaseKey, word);
        const last = attempts.at(-1);
        const priority = (activeKeys.has(key) ? 300 : 0) + (dueKeys.has(key) ? 160 : 0) + (!last ? 120 : 0) + (!last?.correct ? 80 : 0) + (last?.close ? 45 : 0) + Math.max(0, 10 - attempts.length);
        return { ...word, phaseKey, weakLesson:lessons.find((lesson)=>lesson.phaseKey===phaseKey && lesson.category===word.category), priority, jitter:Math.random() };
      })
  );
  return uniqueWords(words.sort((a,b)=>b.priority-a.priority || b.jitter-a.jitter)).slice(0, count);
}
function fastFluencyAttemptsToday(name){
  return allAttemptsToday(name).filter((attempt)=>
    attempt.source === "coach-fluency" &&
    attempt.correct &&
    attempt.mode === "type" &&
    !attempt.close &&
    (attempt.ms || 0) > 0 &&
    (attempt.ms || 0) <= FLUENCY_TARGET_MS
  );
}
function fluencyWords(name){
  if(!name) return [];
  const fastTodayKeys = new Set(fastFluencyAttemptsToday(name).map((attempt)=>`${attempt.hindi}|${attempt.category}`));
  return ["phase1","phase2"].flatMap((phaseKey)=>{
    const mistakeKeys = new Set(activeMistakesFor(name, phaseKey).map(keyFor));
    return phaseWordsFor(phaseKey)
      .filter((word)=>!mistakeKeys.has(keyFor(word)) && !fastTodayKeys.has(keyFor(word)))
      .map((word)=>{
        const attempts = attemptsForWord(name, phaseKey, word);
        const stats = reviewStatsForWord(name, phaseKey, word);
        const lastCorrect = [...attempts].reverse().find((attempt)=>attempt.correct && attempt.mode === "type");
        if(!lastCorrect || !stats) return null;
        const ms = lastCorrect.ms || FLUENCY_TARGET_MS + 1;
        const fragile = Boolean(lastCorrect.close || ms > FLUENCY_TARGET_MS || stats.fragile || stats.correctStreak < 3);
        if(!fragile) return null;
        const priority = (lastCorrect.close ? 400 : 0) + Math.min(ms, 20000) / 50 + (stats.wrongCount * 45) + (stats.overdueDays * 30) + Math.max(0, 3 - stats.correctStreak) * 60;
        return { ...word, phaseKey, fluency:{ ms, priority, correctStreak:stats.correctStreak, wrongCount:stats.wrongCount, overdueDays:stats.overdueDays } };
      })
      .filter(Boolean);
  }).sort((a,b)=>
    b.fluency.priority - a.fluency.priority ||
    b.fluency.wrongCount - a.fluency.wrongCount ||
    a.fluency.correctStreak - b.fluency.correctStreak
  );
}
function appendUniqueLimited(target, words, limit){
  const keys = new Set(target.map(wordSessionKey));
  let added = 0;
  for(const word of words){
    if(added >= limit) break;
    const normalized = { ...word, phaseKey:word.phaseKey || "phase1" };
    const key = wordSessionKey(normalized);
    if(keys.has(key)) continue;
    target.push(normalized);
    keys.add(key);
    added++;
  }
}
function phase1ChallengeFillWords(name, count, excludeKeys=new Set()){
  if(count <= 0) return [];
  const phase1Words = wordsForPhaseWithKey("phase1", phaseWordsFor("phase1"));
  if(!name) return shuffle(phase1Words.filter((word)=>!excludeKeys.has(wordSessionKey(word)))).slice(0, count);
  const todayValue = dateValue(today());
  return phase1Words
    .filter((word)=>!excludeKeys.has(wordSessionKey(word)))
    .map((word)=>{
      const attempts = attemptsForWord(name, "phase1", word);
      const typedCorrectAttempts = attempts.filter((attempt)=>attempt.correct && attempt.mode === "type");
      const typedDays = new Set(typedCorrectAttempts.map(attemptDate).filter(Boolean));
      const last = attempts.at(-1);
      const lastValue = dateValue(attemptDate(last));
      const daysSince = lastValue ? Math.max(0, Math.floor((todayValue - lastValue) / 86400000)) : 99;
      const priority = (!attempts.length ? 240 : 0) + (last && !last.correct ? 120 : 0) + Math.min(daysSince, 45) + Math.max(0, COVERAGE_DAY_TARGET - typedDays.size) * 65 + Math.max(0, 5 - typedCorrectAttempts.length) * 8 + Math.random();
      return { ...word, challengePriority:priority };
    })
    .sort((a,b)=>b.challengePriority-a.challengePriority || lessonRank(b.category)-lessonRank(a.category))
    .slice(0, count);
}
function phase1MaintenanceChallengeWords(name, count=DAILY_CHALLENGE_TARGET){
  const selected = [];
  const mistakes = wordsForPhaseWithKey("phase1", activeMistakesFor(name, "phase1"))
    .sort((a,b)=>(b.count || 0) - (a.count || 0) || (b.lastWrongAt || "").localeCompare(a.lastWrongAt || ""));
  const mistakeKeys = new Set(mistakes.map(wordSessionKey));
  const due = spacedReviewWords(name).filter((word)=>word.phaseKey === "phase1" && !mistakeKeys.has(wordSessionKey(word)));
  const dueKeys = new Set(due.map(wordSessionKey));
  const weak = weakLessonWords(name, count).filter((word)=>word.phaseKey === "phase1" && !mistakeKeys.has(wordSessionKey(word)) && !dueKeys.has(wordSessionKey(word)));
  const weakKeys = new Set(weak.map(wordSessionKey));
  const fluency = fluencyWords(name).filter((word)=>word.phaseKey === "phase1" && !mistakeKeys.has(wordSessionKey(word)) && !dueKeys.has(wordSessionKey(word)) && !weakKeys.has(wordSessionKey(word)));
  const priorityKeys = new Set([...mistakes, ...due, ...weak, ...fluency].map(wordSessionKey));

  appendUniqueLimited(selected, mistakes, CHALLENGE_MISTAKE_LIMIT);
  appendUniqueLimited(selected, due, CHALLENGE_SPACED_LIMIT);
  appendUniqueLimited(selected, weak, CHALLENGE_WEAK_LIMIT);
  appendUniqueLimited(selected, fluency, CHALLENGE_FLUENCY_LIMIT);
  appendUniqueLimited(selected, phase1ChallengeFillWords(name, count - selected.length, new Set([...selected.map(wordSessionKey), ...priorityKeys])), count - selected.length);
  appendUniqueLimited(selected, phase1ChallengeFillWords(name, count - selected.length, new Set(selected.map(wordSessionKey))), count - selected.length);
  return uniqueWords(selected).slice(0, count);
}
function taskProgressLabel(done, target, fallback="Done"){
  if(!target) return fallback;
  return `${Math.min(done, target)}/${target}`;
}
function lessonRank(category){
  const values = [...String(category || "").matchAll(/\d+/g)].map((match)=>Number(match[0]));
  const numeric = values.length ? Math.max(...values) : 0;
  return numeric + (/b\b/i.test(category) ? 0.5 : 0);
}
function latestPhaseCategories(phaseKey, limit=3){
  const seen = [];
  (state.words[phaseKey] || []).forEach((word)=>{
    if(word.english?.length && !seen.includes(word.category)) seen.push(word.category);
  });
  return seen
    .map((category,index)=>({ category, index }))
    .sort((a,b)=>lessonRank(b.category)-lessonRank(a.category) || b.index-a.index)
    .map((item)=>item.category)
    .slice(0, limit);
}
function phase2PrepCategories(limit=1){
  const seen = [];
  phaseWordsFor("phase2").forEach((word)=>{
    if(word.english?.length && !seen.includes(word.category)) seen.push(word.category);
  });
  const bTrack = seen.filter((category)=>/\d+\s*b\b/i.test(category));
  return (bTrack.length ? bTrack : seen)
    .map((category,index)=>({ category, index }))
    .sort((a,b)=>lessonRank(b.category)-lessonRank(a.category) || b.index-a.index)
    .map((item)=>item.category)
    .slice(0, limit);
}
function phase2LessonPrepWords(name, count=DAILY_PHASE2_TARGET){
  if(name !== "maaike") return [];
  const prepCategories = new Set(phase2PrepCategories(1));
  if(!prepCategories.size) return [];
  const mistakeKeys = new Set(activeMistakesFor(name, "phase2").map(keyFor));
  const doneToday = correctTypedWordKeysToday(name, "phase2", (attempt)=>prepCategories.has(attempt.category));
  return phaseWordsFor("phase2")
    .filter((word)=>prepCategories.has(word.category))
    .filter((word)=>!mistakeKeys.has(keyFor(word)))
    .filter((word)=>!doneToday.has(`${word.hindi}|${word.category}`))
    .map((word)=>{
      const attempts = attemptsForWord(name, "phase2", word);
      const typedCorrectAttempts = attempts.filter((attempt)=>attempt.correct && attempt.mode==="type");
      const typedDays = new Set(typedCorrectAttempts.map(attemptDate).filter(Boolean));
      const last = attempts.at(-1);
      const priority = (!last ? 160 : 0) + (!last?.correct ? 120 : 0) + Math.max(0, COVERAGE_DAY_TARGET - typedDays.size) * 90 + Math.max(0, 5 - attempts.length) + Math.random();
      return { ...word, phaseKey:"phase2", prep:{ categories:[...prepCategories], typedDays:typedDays.size, attempts:attempts.length, priority } };
    })
    .sort((a,b)=>b.prep.priority-a.prep.priority || a.prep.typedDays-b.prep.typedDays || a.prep.attempts-b.prep.attempts)
    .slice(0, count);
}
function scoreTaskStatus(name){
  const score = todaysChallengeScore(name);
  const target = score?.total || DAILY_CHALLENGE_TARGET;
  return {
    id: "challenge",
    title: "Phase 1 daily",
    started: Boolean(score),
    done: Boolean(score?.completed),
    progress: score?.completed ? target : score?.correct || 0,
    target,
    label: score?.completed ? `${score.correct || 0}/${target}` : score ? `${score.correct || 0}/${target} locked` : `0/${target}`
  };
}
function mistakeTaskStatus(name){
  const active = allActiveMistakes(name);
  const progress = correctAttemptsToday(name, (attempt)=>attempt.source==="coach-mistakes");
  const target = Math.min(DAILY_MISTAKE_TARGET, progress + active.length);
  return {
    id: "mistakes",
    title: "Mistake repair",
    done: target === 0 || progress >= target,
    progress,
    target,
    active,
    label: taskProgressLabel(progress, target, "Clean")
  };
}
function spacedReviewTaskStatus(name){
  const active = spacedReviewWords(name);
  const progress = correctAttemptsToday(name, (attempt)=>attempt.source==="coach-spaced");
  const target = Math.min(SPACED_REVIEW_TARGET, progress + active.length);
  return {
    id: "spaced",
    title: "Spaced review",
    done: target === 0 || progress >= target,
    progress,
    target,
    active,
    label: taskProgressLabel(progress, target, "Clear")
  };
}
function weakLessonTaskStatus(name){
  const lessons = weakLessonStats(name);
  const active = weakLessonWords(name);
  const progress = correctAttemptsToday(name, (attempt)=>attempt.source==="coach-weak");
  const target = Math.min(DAILY_WEAK_LESSON_TARGET, progress + active.length);
  return {
    id: "weak",
    title: "Weak lesson focus",
    done: target === 0 || progress >= target,
    progress,
    target,
    lessons,
    active,
    label: taskProgressLabel(progress, target, "Stable")
  };
}
function fluencyTaskStatus(name){
  const active = fluencyWords(name);
  const progress = fastFluencyAttemptsToday(name).length;
  const target = Math.min(DAILY_FLUENCY_TARGET, progress + active.length);
  return {
    id: "fluency",
    title: "Fluency sprint",
    done: target === 0 || progress >= target,
    progress,
    target,
    active,
    label: taskProgressLabel(progress, target, "Fast")
  };
}
function wordsForPhaseWithKey(phaseKey, words){
  return (Array.isArray(words) ? words : []).map((word)=>({ ...word, phaseKey }));
}
function smartPracticeWords(phaseKey=phase, count=20){
  const mistakeWords = wordsForPhaseWithKey(phaseKey, user ? activeMistakesFor(user, phaseKey) : []);
  const dueWords = user ? spacedReviewWords(user).filter((word)=>word.phaseKey===phaseKey) : [];
  const weakWords = user ? weakLessonWords(user, count).filter((word)=>word.phaseKey===phaseKey) : [];
  const lessonPrep = user && phaseKey==="phase2" ? phase2LessonPrepWords(user, Math.min(DAILY_PHASE2_TARGET, count)) : [];
  const coverage = user ? coverageWords(user, phaseKey, Math.min(10, count)) : [];
  const latest = new Set(phaseKey==="phase2" ? phase2PrepCategories(3) : latestPhaseCategories(phaseKey, 3));
  const newestWords = wordsForPhaseWithKey(phaseKey, shuffle(phaseWordsFor(phaseKey).filter((word)=>latest.has(word.category))).slice(0, 10));
  const selectedWords = wordsForPhaseWithKey(phaseKey, shuffle(phaseWordsFor(phaseKey).filter((word)=>selectedCategories.has(word.category))));
  return uniqueWords([...mistakeWords, ...dueWords, ...weakWords, ...lessonPrep, ...coverage, ...newestWords, ...selectedWords]).slice(0, count);
}
function smartPracticeHtml(count=20){
  if(!user) return "";
  const words = smartPracticeWords(phase, count);
  const dueCount = spacedReviewWords(user).filter((word)=>word.phaseKey===phase).length;
  const mistakeCount = activeMistakesFor(user, phase).length;
  const weakCount = weakLessonWords(user, count).filter((word)=>word.phaseKey===phase).length;
  const prepCount = phase==="phase2" ? phase2LessonPrepWords(user, Math.min(DAILY_PHASE2_TARGET, count)).length : 0;
  const coverageCount = coverageWords(user, phase, Math.min(10, count)).length;
  const label = words.length ? `${Math.min(words.length, count)} prioritized words` : "No words available";
  return `<div class="smart-practice"><div><strong>Smart practice</strong><small>${label} · ${mistakeCount} mistakes · ${dueCount} spaced · ${weakCount} weak lesson${phase==="phase2"?` · ${prepCount} lesson prep`:""} · ${coverageCount} coverage</small></div><button class="ghost" id="startSmartPractice" type="button" ${words.length?"":"disabled"}>Start smart practice</button></div>`;
}
function phase2TaskStatus(name){
  const categories = phase2PrepCategories(1);
  const categorySet = new Set(categories);
  const active = phase2LessonPrepWords(name, DAILY_PHASE2_TARGET);
  const progress = name === "maaike" ? correctTypedWordKeysToday(name, "phase2", (attempt)=>categorySet.has(attempt.category)).size : 0;
  const target = name === "maaike" ? Math.min(DAILY_PHASE2_TARGET, active.length + progress) : 0;
  return {
    id: "phase2",
    title: "Phase 2 lesson prep",
    done: target === 0 || progress >= target,
    progress,
    target,
    active,
    categories,
    label: taskProgressLabel(progress, target, "Not needed")
  };
}
function capDailyBacklogTasks(tasks){
  let remaining = DAILY_BACKLOG_TARGET;
  const core = new Set(["challenge","phase2"]);
  const backlogPriority = ["mistakes","spaced","weak","fluency"];
  const allowedById = new Map();
  backlogPriority.forEach((id)=>{
    const task = tasks.find((item)=>item.id===id);
    if(!task) return;
    const need = Math.max(0, task.target - task.progress);
    const allowed = Math.min(need, remaining);
    remaining -= allowed;
    allowedById.set(id, allowed);
  });
  return tasks.map((task)=>{
    if(core.has(task.id)) return { ...task, core:true, originalTarget:task.target };
    const originalTarget = task.target;
    const need = Math.max(0, originalTarget - task.progress);
    if(!need) return { ...task, originalTarget, queued:false };
    const allowed = allowedById.get(task.id) || 0;
    const target = task.progress + allowed;
    const queuedCount = need - allowed;
    const queued = queuedCount > 0;
    return {
      ...task,
      originalTarget,
      target,
      queued,
      queuedCount,
      done: target === 0 || task.progress >= target,
      label: taskProgressLabel(task.progress, target, queued && target === 0 ? "Queued" : task.label)
    };
  });
}
function dailyContractFor(name=user){
  const tasks = capDailyBacklogTasks([scoreTaskStatus(name), spacedReviewTaskStatus(name), mistakeTaskStatus(name), weakLessonTaskStatus(name), fluencyTaskStatus(name), phase2TaskStatus(name)]);
  const required = tasks.filter((task)=>task.target > 0);
  const complete = required.every((task)=>task.done);
  const doneUnits = required.reduce((sum,task)=>sum+Math.min(task.progress, task.target),0);
  const targetUnits = required.reduce((sum,task)=>sum+task.target,0);
  return { name, date: today(), tasks, required, complete, doneUnits, targetUnits };
}
function maintenanceStatus(){
  state.maintenance = normalizeMaintenance(state.maintenance);
  const now = Date.now();
  const nextLessonTime = state.maintenance.lessonPrep.nextLessonAt ? Date.parse(state.maintenance.lessonPrep.nextLessonAt) : 0;
  const phase1Sync = state.maintenance.phase1.lastSyncedAt ? Date.parse(state.maintenance.phase1.lastSyncedAt) : 0;
  const phase2Sync = state.maintenance.phase2.lastSyncedAt ? Date.parse(state.maintenance.phase2.lastSyncedAt) : 0;
  const phase1Fresh = Boolean(phase1Sync && now - phase1Sync <= MAINTENANCE_STALE_DAYS * 24 * 60 * 60 * 1000);
  const prepStart = nextLessonTime ? nextLessonTime - PREP_WINDOW_HOURS * 60 * 60 * 1000 : 0;
  const lessonPassed = Boolean(nextLessonTime && nextLessonTime < now);
  const phase2Ready = Boolean(nextLessonTime && phase2Sync >= prepStart && phase2Sync <= nextLessonTime);
  const dueNow = Boolean(nextLessonTime && !lessonPassed && nextLessonTime - now <= PREP_WINDOW_HOURS * 60 * 60 * 1000);
  return { phase1Fresh, phase2Ready, dueNow, lessonPassed, nextLessonTime, phase1Sync, phase2Sync };
}
function formatDateTime(iso){
  if(!iso) return "Never";
  const date = new Date(iso);
  if(Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleString([], { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function dateTimeInputValue(iso){
  if(!iso) return "";
  const date = new Date(iso);
  if(Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0,16);
}
function isoFromDateTimeInput(value){
  if(!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function taskCardHtml(task, body, actionHtml=""){
  const stateClass = task.queued && task.target === task.progress ? "task-queued" : task.done ? "task-done" : "task-open";
  const status = task.queued && task.target === task.progress ? "Queued" : task.done ? "Done" : "Due";
  return `<div class="coach-task ${stateClass}"><div class="task-head"><div><span>${escapeHtml(task.title)}</span><strong>${escapeHtml(task.label)}</strong></div><b>${status}</b></div>${body}${actionHtml}</div>`;
}
function whatsappProofText(contract){
  const taskText = contract.tasks.map((task)=>`${task.title}: ${task.label}`).join(" | ");
  return `Hindi done for ${displayDate(contract.date)}. ${taskText}. Tomorrow I do it again.`;
}
function whatsappProofUrl(contract){
  return `https://wa.me/?text=${encodeURIComponent(whatsappProofText(contract))}`;
}
function coachHeroHtml(contract){
  const pct = contract.targetUnits ? Math.round((contract.doneUnits / contract.targetUnits) * 100) : 100;
  return `<div class="coach-hero"><div><div class="daily-badge">Daily contract</div><h2>Hindi Coach</h2><p>${contract.complete?"Today is complete. Send the receipt and keep the streak clean.":"Finish the contract before the rest of the app becomes useful."}</p></div><div class="contract-meter"><strong>${pct}%</strong><span>${contract.doneUnits}/${contract.targetUnits || 0} required answers</span></div></div>`;
}
function coachChallengeHtml(task){
  const body = `<p>Adaptive Phase 1 maintenance: mistakes, due words and weak words first. One timed attempt per day, saved to the scoreboard.</p>`;
  const action = task.done
    ? `<button class="retry-btn secondary-action" id="coachChallengeReview" type="button">Review result</button>`
    : task.started
      ? `<button class="retry-btn secondary-action" id="coachChallengeReview" type="button">Review locked score</button>`
    : `<button class="start-btn" id="startCoachChallenge" type="button">Start Phase 1 daily</button>`;
  return taskCardHtml(task, body, action);
}
function coachMistakesHtml(task){
  const phase1Count = activeMistakesFor(user, "phase1").length;
  const phase2Count = activeMistakesFor(user, "phase2").length;
  const queueNote = task.queued ? ` ${task.queuedCount} repair${task.queuedCount===1?"":"s"} stay queued to keep today light.` : "";
  const body = `<p>${task.target ? (task.done ? `Daily mistake repair complete. ${task.active.length} active mistake word${task.active.length===1?"":"s"} left for spaced confirmation.` : `${task.active.length} active mistake words. Repair ${task.target} today. A mistake clears after typed recall on ${MISTAKE_REPAIR_DAY_TARGET} different days.${queueNote}`) : task.active.length ? `${task.active.length} active mistake words are queued for another day. The daily workload cap keeps the habit sustainable.` : "No active mistake words right now."}</p>`;
  const action = task.target
    ? `<div class="coach-actions"><button class="ghost" id="startCoachMistakes1" type="button" ${phase1Count?"":"disabled"}>Phase 1 mistakes (${phase1Count})</button><button class="ghost" id="startCoachMistakes2" type="button" ${phase2Count?"":"disabled"}>Phase 2 mistakes (${phase2Count})</button></div>`
    : "";
  return taskCardHtml(task, body, action);
}
function coachSpacedHtml(task){
  const phase1Count = task.active.filter((word)=>word.phaseKey==="phase1").length;
  const phase2Count = task.active.filter((word)=>word.phaseKey==="phase2").length;
  const queueNote = task.queued ? ` ${task.queuedCount} extra due word${task.queuedCount===1?"":"s"} stay queued for later.` : "";
  const body = task.target
    ? task.done
      ? `<p>Daily spaced review complete. ${task.active.length} extra due word${task.active.length===1?"":"s"} stay queued for later.</p>`
      : `<p>${task.active.length} due words from earlier days. Today: ${phase1Count} Phase 1, ${phase2Count} Phase 2. Typed recall controls long-term spacing.${queueNote}</p>`
    : task.active.length
      ? `<p>${task.active.length} spaced-review word${task.active.length===1?" is":"s are"} queued for another day. Choice-only correct answers still come back quickly.</p>`
      : `<p>No spaced-review words due right now. Choice-only correct answers come back quickly until typed recall is strong.</p>`;
  const action = task.target && !task.done
    ? `<button class="start-btn" id="startCoachSpaced" type="button">Start spaced review</button>`
    : "";
  return taskCardHtml(task, body, action);
}
function coachWeakLessonHtml(task){
  const names = task.lessons?.length ? task.lessons.map((lesson)=>displayCategory(lesson.category)).join(", ") : "";
  const queueNote = task.queued ? ` ${task.queuedCount} extra weak-lesson word${task.queuedCount===1?"":"s"} queued.` : "";
  const body = task.target
    ? task.done
      ? `<p>Weak lesson focus complete. The weakest categories will update as your answers change.</p>`
      : `<p>Focused mix from ${escapeHtml(names)}. Practise ${task.target} words from the weakest lesson pattern.${queueNote}</p>`
    : task.active.length
      ? `<p>Weak lesson focus is queued for another day so today stays realistic.</p>`
      : `<p>No weak lesson pattern yet. Keep answering and this will appear when a category starts lagging.</p>`;
  const action = task.target && !task.done
    ? `<button class="start-btn" id="startCoachWeak" type="button">Start weak lesson focus</button>`
    : "";
  return taskCardHtml(task, body, action);
}
function coachFluencyHtml(task){
  const slowCount = task.active.filter((word)=>word.fluency?.ms > FLUENCY_TARGET_MS).length;
  const queueNote = task.queued ? ` ${task.queuedCount} extra fluency word${task.queuedCount===1?"":"s"} queued.` : "";
  const body = task.target
    ? task.done
      ? `<p>Fast recall complete. Correct-but-slow words will keep cycling back.</p>`
      : `<p>${task.active.length} nearly-known word${task.active.length===1?"":"s"} need faster recall. ${slowCount} were slow last time.${queueNote}</p>`
    : task.active.length
      ? `<p>Fluency sprint is queued for another day. Slow-but-known words will keep cycling back.</p>`
      : `<p>No slow-but-known words right now. New fragile correct answers will appear here.</p>`;
  const action = task.target && !task.done
    ? `<button class="start-btn" id="startCoachFluency" type="button">Start fluency sprint</button>`
    : "";
  return taskCardHtml(task, body, action);
}
function coachPhase2Html(task){
  const lessons = task.categories.length ? task.categories.map(displayCategory).join(", ") : "No Phase 2 words";
  const body = task.target
    ? `<p>Small prep from ${escapeHtml(lessons)} before the next lesson. ${task.target} typed recalls, so this stays light next to Phase 1 maintenance.</p>`
    : `<p>Current prep lesson: ${escapeHtml(lessons)}. All required words for today are done.</p>`;
  const action = task.target
    ? `<button class="start-btn" id="startCoachPhase2" type="button">Start lesson prep</button>`
    : "";
  return taskCardHtml(task, body, action);
}
function coachProofHtml(contract){
  const text = escapeHtml(whatsappProofText(contract));
  const action = contract.complete
    ? `<a class="start-btn coach-whatsapp" id="whatsappProof" href="${whatsappProofUrl(contract)}" target="_blank" rel="noopener">Send WhatsApp proof</a>`
    : `<button class="start-btn" type="button" disabled>WhatsApp proof locked</button>`;
  return `<div class="coach-proof"><div><h3>Receipt</h3><p>${text}</p></div>${action}</div>`;
}
function maintenanceHtml(){
  const status = maintenanceStatus();
  const phase1 = state.maintenance.phase1;
  const phase2 = state.maintenance.phase2;
  const prep = state.maintenance.lessonPrep;
  const phase1Status = status.phase1Fresh ? "Fresh" : "Sync due";
  const phase2Status = !prep.nextLessonAt ? "No lesson set" : status.lessonPassed ? "Lesson passed" : status.phase2Ready ? "Ready" : status.dueNow ? "Prep due now" : "Planned";
  return `<div class="coach-maintenance"><div class="maintenance-head"><div><h3>Lesson list maintenance</h3><p>Phase 1 stays maintained. Phase 2 gets checked before lessons.</p></div><button class="ghost" id="openManage" type="button">Manage lists</button></div><div class="maintenance-grid"><div><span>Phase 1</span><strong>${phase1Status}</strong><small>${phase1.lastCount || state.words.phase1.length} words · last sync ${formatDateTime(phase1.lastSyncedAt)}</small><button class="ghost" id="coachSyncPhase1" type="button">Sync Phase 1</button></div><div><span>Phase 2</span><strong>${phase2Status}</strong><small>${phase2.lastCount || state.words.phase2.length} words · last sync ${formatDateTime(phase2.lastSyncedAt)}</small><button class="ghost" id="coachSyncPhase2" type="button">Sync Phase 2</button></div></div><label class="form-label" for="nextLessonAt">Next Hindi lesson</label><div class="lesson-prep-row"><input id="nextLessonAt" type="datetime-local" value="${dateTimeInputValue(prep.nextLessonAt)}"><button class="retry-btn" id="saveLessonPrep" type="button">Save lesson prep</button></div><p id="coachSyncStatus" class="sync-line">${prep.checkedAt?`Last prep check ${formatDateTime(prep.checkedAt)}.`:"No prep check saved yet."}</p></div>`;
}
function renderCoach(){
  if(!user)return showLogin();
  const contract = dailyContractFor(user);
  const notice = coachNotice ? `<div class="coach-notice">${escapeHtml(coachNotice)}</div>` : "";
  const tasks = Object.fromEntries(contract.tasks.map((task)=>[task.id, task]));
  $("#coach").innerHTML = `<div class="coach-shell">${notice}${coachHeroHtml(contract)}<div class="coach-grid">${coachChallengeHtml(tasks.challenge)}${coachSpacedHtml(tasks.spaced)}${coachMistakesHtml(tasks.mistakes)}${coachWeakLessonHtml(tasks.weak)}${coachFluencyHtml(tasks.fluency)}${coachPhase2Html(tasks.phase2)}</div>${coachProofHtml(contract)}${user==="maaike"?maintenanceHtml():""}</div>`;
  $("#startCoachChallenge")?.addEventListener("click",async()=>{ await loadCloudState({ rerender:false }); phase="phase1"; selectedCategories=new Set(categories()); startSession("challenge",DAILY_CHALLENGE_TARGET,"mixed"); });
  $("#coachChallengeReview")?.addEventListener("click",()=>show("challenge"));
  $("#startCoachSpaced")?.addEventListener("click",()=>startCoachSpacedReview());
  $("#startCoachWeak")?.addEventListener("click",()=>startCoachWeakLesson());
  $("#startCoachFluency")?.addEventListener("click",()=>startCoachFluency());
  $("#startCoachPhase2")?.addEventListener("click",()=>startPhase2Focus());
  $("#startCoachMistakes1")?.addEventListener("click",()=>startCoachMistakes("phase1"));
  $("#startCoachMistakes2")?.addEventListener("click",()=>startCoachMistakes("phase2"));
  $("#openManage")?.addEventListener("click",()=>show("manage"));
  $("#coachSyncPhase1")?.addEventListener("click",()=>syncPhase1FromSheet($("#coachSyncStatus")));
  $("#coachSyncPhase2")?.addEventListener("click",()=>syncPhase2FromSheet($("#coachSyncStatus")));
  $("#saveLessonPrep")?.addEventListener("click",()=>{ state.maintenance = normalizeMaintenance(state.maintenance); state.maintenance.lessonPrep = { ...state.maintenance.lessonPrep, nextLessonAt: isoFromDateTimeInput($("#nextLessonAt").value), checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; save({ immediate:true }); renderCoach(); });
}
function coachTaskById(id){
  return dailyContractFor(user).tasks.find((task)=>task.id===id);
}
function startCoachSpacedReview(){
  const task = coachTaskById("spaced") || spacedReviewTaskStatus(user);
  const count = Math.max(0, task.target - task.progress);
  if(!count) return renderCoach();
  const words = task.active.slice(0, count);
  if(!words.length) return renderCoach();
  startWordSession(words, "coach-spaced");
}
function startCoachWeakLesson(){
  const task = coachTaskById("weak") || weakLessonTaskStatus(user);
  const count = Math.max(0, task.target - task.progress);
  if(!count) return renderCoach();
  const words = task.active.slice(0, count);
  if(!words.length) return renderCoach();
  startWordSession(words, "coach-weak");
}
function startCoachFluency(){
  const task = coachTaskById("fluency") || fluencyTaskStatus(user);
  const count = Math.max(0, task.target - task.progress);
  if(!count) return renderCoach();
  const words = task.active.slice(0, count);
  if(!words.length) return renderCoach();
  startWordSession(words, "coach-fluency");
}
function startPhase2Focus(){
  phase = "phase2";
  const task = coachTaskById("phase2") || phase2TaskStatus(user);
  const remaining = Math.max(0, task.target - task.progress);
  if(!remaining) return renderCoach();
  const words = task.active.slice(0, remaining);
  selectedCategories = new Set((words.length ? words : phaseWordsFor("phase2")).map((word)=>word.category));
  if(!selectedCategories.size) selectedCategories = new Set(latestPhaseCategories("phase2", 3));
  save();
  if(words.length) startWordSession(words, "coach-phase2");
  else startSession("coach-phase2", remaining, "mixed");
}
function startCoachMistakes(phaseKey){
  const words = activeMistakesFor(user, phaseKey);
  if(!words.length) return renderCoach();
  phase = phaseKey;
  selectedCategories = new Set(words.map((word)=>word.category));
  save();
  const task = coachTaskById("mistakes") || mistakeTaskStatus(user);
  const remaining = Math.max(0, task.target - task.progress);
  if(!remaining) return renderCoach();
  startWordSession(words.slice(0, remaining), "coach-mistakes");
}
function renderQuizSetup(){
  if(!selectedCategories.size) selectedCategories = new Set(categories());
  $("#quiz").innerHTML = `<div class="setup-card">${phaseToggleHtml()}<h2>${PHASE_DATA[phase].title}</h2><label class="form-label">Mode</label><div class="mode-toggle"><button class="${mode==="mixed"?"selected":""}" data-mode="mixed">Mixed</button><button class="${mode==="type"?"selected":""}" data-mode="type">Hindi → English</button><button class="${mode==="recall"?"selected":""}" data-mode="recall">English → Hindi recall</button><button class="${mode==="mc"?"selected":""}" data-mode="mc">English → Hindi choices</button></div><label class="form-label">Categories</label>${renderCategoryChips()}<label class="form-label">Words</label><input id="wordCount" type="number" min="1" max="200" value="20">${smartPracticeHtml(20)}<button class="start-btn" id="startPractice">Start practice</button></div>`;
  bindPhaseButtons(); bindCategoryChips();
  document.querySelectorAll("[data-mode]").forEach((button)=>button.addEventListener("click",()=>{mode=button.dataset.mode; renderQuizSetup();}));
  $("#startSmartPractice")?.addEventListener("click",()=>startWordSession(smartPracticeWords(phase, Number($("#wordCount").value||20)), "smart-practice"));
  $("#startPractice").addEventListener("click",()=>startSession("practice", Number($("#wordCount").value||20)));
}
function randomMode(){
  const roll = Math.random();
  if(roll < .7) return "type";
  if(roll < .9) return "recall";
  return "mc";
}
function typeOnlySource(source){
  return ["coach-spaced","coach-mistakes","coach-fluency","coach-phase2","round-repair","mistakes"].includes(source);
}
function recallBlendSource(source){
  return ["coach-weak","smart-practice"].includes(source);
}
function recallBlendMode(){
  return Math.random() < .78 ? "type" : "recall";
}
function challengeQuestionCounts(total){
  const choices = total >= 3 ? Math.floor(total * 0.2) : 0;
  return { typed:Math.max(0, total - choices), choices };
}
function challengeModes(total){
  const { typed:typeCount, choices:mcCount } = challengeQuestionCounts(total);
  return shuffle([
    ...Array(typeCount).fill("type"),
    ...Array(mcCount).fill("mc")
  ]);
}
function sessionModeForQuestion(value){
  if(value.source==="challenge") return value.modes[value.index];
  if(value.mode==="mixed" && typeOnlySource(value.source)) return "type";
  if(value.mode==="mixed" && recallBlendSource(value.source)) return recallBlendMode();
  if(value.mode==="mixed") return randomMode();
  return value.mode;
}
function startSession(source, count=20, forcedMode=mode){
  if(source==="challenge" && todaysChallengeScore()) return show("challenge");
  const pool = phaseWords().filter((word)=>selectedCategories.has(word.category));
  const queue = source === "challenge"
    ? phase1MaintenanceChallengeWords(user, count)
    : shuffle([...pool]).slice(0, Math.min(count, pool.length)).map((word)=>({ ...word, phaseKey:phase }));
  session = { source, phaseKey:phase, queue, index:0, correct:0, wrong:0, approved:0, mode:forcedMode, started:0, modes:[], missed:{} };
  if(source==="challenge"){
    session.modes = challengeModes(queue.length);
    session.score = createChallengeScore(queue.length);
    lockChallengeNavigation();
  }
  renderQuestion();
}
function startWordSession(words, source="practice"){
  if(!words.length) return;
  session = { source, phaseKey:phase, queue:shuffle(uniqueWords(words)), index:0, correct:0, wrong:0, approved:0, mode:"mixed", started:0, modes:[], missed:{} };
  show("quiz");
  renderQuestion();
}
function startRepairSession(words, returnScreen="quiz"){
  const queue = uniqueWords(words);
  if(!queue.length) return show(returnScreen);
  session = { source:"round-repair", phaseKey:phase, returnScreen, queue:shuffle(queue), index:0, correct:0, wrong:0, approved:0, mode:"mixed", started:0, modes:[], missed:{}, repair:true };
  show("quiz");
  renderQuestion();
}
function renderQuestion(){
  clearTimer();
  clearNextKeyHandler();
  if(!session || session.index>=session.queue.length) return finishSession();
  session.awaitingNext = false;
  const word = session.queue[session.index];
  const qMode = sessionModeForQuestion(session);
  session.currentMode = qMode; session.started = performance.now();
  const progress = Math.round((session.index/session.queue.length)*100);
  $("#quiz").classList.remove("hidden"); screens.filter(id=>id!=="quiz").forEach(id=>$("#"+id).classList.add("hidden"));
  const secondsLimit = questionTimeLimit(qMode);
  $("#quiz").innerHTML = `<div class="quiz-active">${secondsLimit?timerHtml():""}<div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div><div class="score-display">${session.index+1}/${session.queue.length} · ${session.correct} correct</div><div class="quiz-card">${qMode==="mc"?mcHtml(word):qMode==="recall"?recallHtml(word):typeHtml(word, qMode)}<div id="feedback" class="feedback"></div><div id="feedbackButtons" class="feedback-buttons"></div></div></div>`;
  if(qMode==="type"){ $("#answerInput").focus(); $("#answerForm").addEventListener("submit",(event)=>{event.preventDefault(); answerType(word);}); }
  else if(qMode==="mc") bindMc(word);
  else bindRecall(word);
  if(secondsLimit) startTimer(secondsLimit);
}
function questionTimeLimit(qMode){
  if(session?.source === "challenge") return qMode === "mc" ? 12 : 20;
  if(session?.source === "coach-fluency") return FLUENCY_TIMER_SECONDS;
  return 0;
}
function timerHtml(){
  const label = session?.source === "coach-fluency" ? "Fluency timer" : "Daily timer";
  return `<div class="timer"><div class="timer-row"><span>${label}</span><strong id="timerNum"></strong></div><div class="timer-bar"><div id="timerFill" class="timer-fill"></div></div></div>`;
}
function typeHtml(word){
  return `<div class="hindi-word">${word.hindi}</div><form id="answerForm" class="answer-form"><input id="answerInput" class="answer-input" autocomplete="off" placeholder="Type in English"><button class="check-btn" type="submit">Check</button></form>`;
}
function mcHtml(word){ const choices=makeChoices(word); return `<div class="english-word">${escapeHtml(formatPrimaryEnglish(word))}</div><div class="mc-options">${choices.map((choice)=>`<button class="mc-btn" type="button">${escapeHtml(choice.hindi)}</button>`).join("")}</div>`; }
function recallHtml(word){
  return `<div class="english-word">${escapeHtml(formatPrimaryEnglish(word))}</div><div class="recall-actions"><button class="check-btn" id="showRecallAnswer" type="button">Show answer</button></div>`;
}
function choiceDistractorScore(word, candidate, latest){
  const targetEnglish = normEnglish(formatPrimaryEnglish(word));
  const candidateEnglish = normEnglish(formatPrimaryEnglish(candidate));
  const categoryMatch = candidate.category === word.category ? 1000 : 0;
  const currentLesson = latest.has(candidate.category) ? 120 : 0;
  const lessonDistance = Math.abs(lessonRank(candidate.category) - lessonRank(word.category));
  const answerLengthGap = Math.abs(candidateEnglish.length - targetEnglish.length);
  return categoryMatch + currentLesson - lessonDistance * 12 - answerLengthGap * 0.5 + Math.random();
}
function makeChoices(word){
  const phaseKey = wordPhaseKey(word);
  const latest = new Set(latestPhaseCategories(phaseKey, 4));
  const others = phaseWordsFor(phaseKey)
    .filter((candidate)=>normHindi(candidate.hindi)!==normHindi(word.hindi))
    .map((candidate)=>({ word:candidate, score:choiceDistractorScore(word, candidate, latest) }))
    .sort((a,b)=>b.score-a.score)
    .map((item)=>item.word);
  return shuffle([word,...uniqueWords(others).slice(0,3)]);
}
function bindMc(word){ document.querySelectorAll(".mc-btn").forEach((button)=>button.addEventListener("click",()=>answerMc(word, button))); }
function bindRecall(word){ $("#showRecallAnswer")?.addEventListener("click",()=>showRecallAnswer(word)); }
function answerType(word){ const answer=$("#answerInput").value.trim(); const result=checkAnswer(answer, word.english); completeAnswer(word,result.correct,result.close,answer); }
function answerMc(word, button){ const correct=normHindi(button.textContent)===normHindi(word.hindi); document.querySelectorAll(".mc-btn").forEach((btn)=>{btn.disabled=true; if(normHindi(btn.textContent)===normHindi(word.hindi)) btn.classList.add("correct"); else if(btn===button) btn.classList.add("wrong"); else btn.classList.add("dimmed");}); completeAnswer(word, correct, false, button.textContent); }
function showRecallAnswer(word){
  $("#showRecallAnswer")?.setAttribute("disabled", "true");
  const fb = $("#feedback");
  fb.className = "feedback";
  fb.innerHTML = correctTranslationHtml(word);
  $("#feedbackButtons").innerHTML = `<button class="btn-missed" id="recallMissed" type="button">Missed it</button><button class="btn-known" id="recallKnown" type="button">I knew it</button>`;
  $("#recallKnown")?.focus();
  $("#recallKnown")?.addEventListener("click",()=>completeAnswer(word, true, false, "self-check known"));
  $("#recallMissed")?.addEventListener("click",()=>completeAnswer(word, false, false, "self-check missed"));
}
function correctTypeAnswerHtml(word){
  return `<div class="answer-reveal answer-reveal-big answer-reveal-type"><span>Correct answer</span><strong>${escapeHtml(formatEnglishList(word))}</strong><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}</div>`;
}
function correctTranslationHtml(word){
  return `<div class="answer-reveal answer-reveal-big"><span>Correct translation</span><strong class="answer-pair"><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}<em>${escapeHtml(formatEnglishList(word))}</em></strong></div>`;
}
function correctTranslationSuccessHtml(word){
  return `<div class="answer-reveal answer-reveal-big answer-reveal-success"><span>Correct answer</span><strong class="answer-pair"><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}<em>${escapeHtml(formatEnglishList(word))}</em></strong></div>`;
}
function correctTypeSuccessHtml(word, close){
  return `<div class="answer-reveal answer-reveal-big answer-reveal-type answer-reveal-success"><span>${close ? "Accepted answer" : "Correct answer"}</span><strong>${escapeHtml(formatEnglishList(word))}</strong><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}</div>`;
}
function completeAnswer(word, correct, close, answer=""){
  if(!session || session.awaitingNext) return;
  const elapsedMs = session?.started ? Math.max(0, Math.round(performance.now() - session.started)) : 0;
  session.awaitingNext = true;
  clearTimer();
  $("#answerInput")?.setAttribute("disabled", "true");
  $("#answerForm button")?.setAttribute("disabled", "true");
  document.querySelectorAll(".mc-btn").forEach((button)=>button.disabled = true);
  if(correct) session.correct++;
  else {
    session.wrong++;
    session.missed[wordSessionKey(word)] = word;
  }
  updateChallengeScore(false);

  const attemptId=recordAttempt(word, correct, close, answer, elapsedMs);
  const fb=$("#feedback");
  const isTyping = session.currentMode === "type";
  const isRecall = session.currentMode === "recall";
  const isFluency = session.source === "coach-fluency";
  const fastExact = correct && !close && elapsedMs > 0 && elapsedMs <= FLUENCY_TARGET_MS;
  const successLine = correct
    ? (isTyping ? correctTypeSuccessHtml(word, close) : correctTranslationSuccessHtml(word))
    : "";
  const fluencyLine = isFluency && correct
    ? `<div class="typed-answer"><span>Fluency target</span><strong>${fastExact ? `Fast exact recall (${seconds(elapsedMs)})` : `Correct, repeat for speed (${seconds(elapsedMs)})`}</strong></div>`
    : "";
  const answerLine = !correct
    ? (isTyping ? correctTypeAnswerHtml(word) : correctTranslationHtml(word))
    : "";
  const typedLine = !correct&&isTyping
    ? `<div class="typed-answer"><span>You typed</span><strong>${escapeHtml(answer || "(empty)")}</strong></div>`
    : "";
  const selectedLine = !correct&&!isTyping&&!isRecall
    ? `<div class="typed-answer"><span>You chose</span><strong>${escapeHtml(answer || "(empty)")}</strong></div>`
    : "";
  const canApprove = !correct && session.source !== "challenge" && !isRecall;
  const requiresReview = !correct && session.source === "challenge";

  fb.className=`feedback ${correct?(close?"close":"good"):"bad"}`;
  fb.innerHTML=correct
    ? `${successLine || (close?`Accepted <small>${escapeHtml(formatPrimaryEnglish(word))}</small>`:`Correct <small>${escapeHtml(formatPrimaryEnglish(word))}</small>`)}${fluencyLine}`
    : `${answerLine}${typedLine}${selectedLine}`;
  $("#feedbackButtons").innerHTML=`${canApprove?'<button class="btn-approve" id="approveBtn">Count as correct</button>':""}<button class="btn-next" id="nextBtn" ${requiresReview?"disabled":""}>Next →</button>`;
  const nextButton = $("#nextBtn");
  if(requiresReview) setTimeout(()=>{ if(nextButton){ nextButton.disabled = false; nextButton.focus(); } }, CHALLENGE_REVIEW_MS);
  else nextButton?.focus();
  nextButton?.addEventListener("click", nextQuestion);
  $("#approveBtn")?.addEventListener("click",()=>{session.correct++; session.wrong--; session.approved++; delete session.missed[wordSessionKey(word)]; approveAttempt(attemptId, word); $("#approveBtn").remove();});
  nextKeyHandler=(event)=>{if(event.key==="Enter" && nextButton && !nextButton.disabled){event.preventDefault(); nextQuestion();}};
  document.addEventListener("keydown",nextKeyHandler);
}
function clearNextKeyHandler(){
  if(nextKeyHandler){
    document.removeEventListener("keydown", nextKeyHandler);
    nextKeyHandler = null;
  }
}
function nextQuestion(){ clearNextKeyHandler(); session.index++; renderQuestion(); }
function recordAttempt(word, correct, close, answer, elapsedMs=null){
  if(!user) return null;
  const phaseKey = wordPhaseKey(word);
  const createdAt = new Date().toISOString();
  const attempt = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: createdAt.slice(0,10),
    createdAt,
    week: weekKey(createdAt),
    phase: phaseKey,
    source: session?.source || "practice",
    mode: session?.currentMode || mode,
    hindi: word.hindi,
    english: [...word.english],
    category: word.category,
    answer: String(answer || "").trim(),
    correct: Boolean(correct),
    close: Boolean(close),
    approved: false,
    ms: Number.isFinite(elapsedMs) ? elapsedMs : session?.started ? Math.max(0, Math.round(performance.now() - session.started)) : 0
  };
  state.attempts[user][phaseKey].push(attempt);
  state.attempts[user][phaseKey] = state.attempts[user][phaseKey].slice(-2500);
  updateMistakeStatus(word, correct, answer);
  save();
  return attempt.id;
}
function updateMistakeStatus(word, correct, answer){
  const phaseKey = wordPhaseKey(word);
  const bucket=state.mistakes[user][phaseKey];
  const key=keyFor(word);
  if(correct){
    if(bucket[key]){
      bucket[key].streak=(bucket[key].streak||0)+1;
      bucket[key].lastCorrectAt=new Date().toISOString();
      if(session?.currentMode === "type"){
        const repairDays = new Set(Array.isArray(bucket[key].repairDays) ? bucket[key].repairDays : []);
        repairDays.add(today());
        bucket[key].repairDays = [...repairDays].sort();
      }
      if(repairDayCount(bucket[key]) >= MISTAKE_REPAIR_DAY_TARGET) delete bucket[key];
    }
    return;
  }
  bucket[key]={...word,count:(bucket[key]?.count||0)+1,streak:0,repairDays:[],lastWrongAt:new Date().toISOString(),lastAnswer:String(answer||"").trim()};
}
function approveAttempt(id, word){
  if(!user || !id) return;
  const phaseKey = wordPhaseKey(word);
  const attempt=state.attempts[user][phaseKey].find((item)=>item.id===id);
  if(attempt){ attempt.correct=true; attempt.approved=true; }
  const bucket=state.mistakes[user][phaseKey];
  const key=keyFor(word);
  if(bucket[key]){
    bucket[key].count=Math.max(0,(bucket[key].count||1)-1);
    if(bucket[key].count===0) delete bucket[key];
  }
  save();
}
function clearTimer(){ if(timer){clearInterval(timer); timer=null;} }
function startTimer(seconds){ let remaining=seconds; $("#timerNum").textContent=remaining+"s"; $("#timerFill").style.width="100%"; timer=setInterval(()=>{remaining--; $("#timerNum").textContent=remaining+"s"; $("#timerFill").style.width=Math.max(0,(remaining/seconds)*100)+"%"; if(remaining<=0){clearTimer(); completeAnswer(session.queue[session.index],false,false);}},1000); }
function completionBackScreen(finished){
  if(finished?.returnScreen) return finished.returnScreen;
  if(finished?.source === "challenge" || String(finished?.source || "").startsWith("coach-")) return "coach";
  return "quiz";
}
function completionTitle(finished, missed){
  if(finished?.repair && missed.length) return "Repair round";
  if(finished?.repair) return "All repaired";
  if(finished?.source === "challenge") return "Daily complete";
  if(finished?.source === "coach-weak") return "Weak lesson focus complete";
  if(finished?.source === "coach-fluency") return "Fluency sprint complete";
  return "Session complete";
}
function repairPanelHtml(missed, finished){
  if(missed.length){
    const intro = finished?.repair ? "Keep going with only the words still wrong." : "Practise only the words you missed in this round.";
    return `<div class="repair-box"><strong>${missed.length} word${missed.length===1?"":"s"} to repair</strong><p>${intro}</p><div class="repair-list">${missed.slice(0,8).map((word)=>`<span>${escapeHtml(word.hindi)} · ${escapeHtml(formatPrimaryEnglish(word))}</span>`).join("")}${missed.length>8?`<span>+${missed.length-8} more</span>`:""}</div><button class="retry-btn" id="repairRoundMistakes" type="button">${finished?.repair?"Try remaining words again":"Repair missed words now"}</button></div>`;
  }
  if(finished?.repair) return `<div class="repair-box repair-done"><strong>Clean repair</strong><p>Every word in this repair round was correct.</p></div>`;
  return "";
}
function renderSessionComplete(finished){
  const missed = sessionMissedWords(finished);
  const backScreen = completionBackScreen(finished);
  const backLabel = backScreen === "coach" ? "Back to coach" : "Back to practice";
  $("#quiz").innerHTML=`<div class="panel session-complete"><h2>${completionTitle(finished, missed)}</h2><div class="result-grid"><div class="stat-box"><strong>${finished.correct}/${finished.queue.length}</strong><br><small>correct</small></div><div class="stat-box"><strong>${Math.round((finished.correct/finished.queue.length)*100)}%</strong><br><small>score</small></div></div>${repairPanelHtml(missed, finished)}<button class="retry-btn secondary-action" id="backToPractice" type="button">${backLabel}</button></div>`;
  session=null;
  renderNav();
  $("#repairRoundMistakes")?.addEventListener("click",()=>startRepairSession(missed, backScreen));
  $("#backToPractice")?.addEventListener("click",()=>show(backScreen));
}
function finishSession(){
  clearTimer();
  const finished = session;
  if(finished.source==="challenge" && user){
    updateChallengeScore(true);
    pushCloudState();
  }
  renderSessionComplete(finished);
}
function challengeReviewHtml(){
  const misses = todaysChallengeAttempts().filter((attempt)=>!attempt.correct);
  const title = misses.length ? `Words to review (${misses.length})` : "Words to review";
  return `<div class="daily-review"><div class="daily-review-title">${escapeHtml(title)}</div>${misses.length?`<div class="miss-list">${misses.map(missedWordCard).join("")}</div><button class="retry-btn" id="repairChallengeMistakes" type="button">Repair these words</button>`:`<div class="chart-empty">No mistakes today. Annoying, but impressive.</div>`}</div>`;
}
function renderChallenge(){
  if(!user)return showLogin();
  phase="phase1";
  selectedCategories=new Set(categories());
  save();
  const done=todaysChallengeScore();
  const recent=state.scores[user].filter((score)=>score.phase==="phase1").slice(-7);
  const best=recent.reduce((max,score)=>Math.max(max,score.correct||0),0);
  const average=recent.length?Math.round(recent.reduce((sum,score)=>sum+(score.correct||0),0)/recent.length):0;
  const doneLabel = done?.completed ? "Done today" : "Started today";
  const doneNote = done?.completed ? "score" : "locked score so far";
  const total = done?.total || DAILY_CHALLENGE_TARGET;
  const questionCounts = challengeQuestionCounts(total);
  $("#challenge").innerHTML=`<div class="challenge-card daily-card"><div class="daily-badge">Phase 1 daily</div><h2>Daily Challenge</h2><p class="challenge-date">${displayDate(today())}</p><div class="daily-metrics"><div><strong>${total}</strong><small>words</small></div><div><strong>${questionCounts.typed}</strong><small>typed recall</small></div><div><strong>${questionCounts.choices}</strong><small>choices</small></div><div><strong>${recent.length?best:"-"}</strong><small>7-run best</small></div></div><p class="challenge-info">An adaptive Phase 1 maintenance run: weak, due and recently missed words come first, then broad coverage. Once you start, today’s attempt is locked.</p>${done?`<div class="daily-result"><span>${doneLabel}</span><strong>${done.correct}/${total}</strong><small>${Math.round(((done.correct||0)/total)*100)}% ${doneNote} · 7-run average ${average || 0}/${DAILY_CHALLENGE_TARGET}</small></div>${done.completed?challengeReviewHtml():""}<div class="daily-actions"><button class="retry-btn secondary-action" id="practiceAfterChallenge" type="button">Practise Phase 1</button><button class="retry-btn" id="goScoreboard" type="button">Go to scoreboard</button></div>`:`<button class="start-btn daily-start" id="startChallenge" type="button">Start today’s challenge</button>`}</div>`;
  $("#startChallenge")?.addEventListener("click",async()=>{ await loadCloudState({ rerender:false }); startSession("challenge",DAILY_CHALLENGE_TARGET,"mixed"); });
  $("#repairChallengeMistakes")?.addEventListener("click",()=>startRepairSession(missedWordsFromAttempts(todaysChallengeAttempts()), "coach"));
  $("#practiceAfterChallenge")?.addEventListener("click",()=>show("quiz"));
  $("#goScoreboard")?.addEventListener("click",()=>show("scoreboard"));
}
function renderMistakes(){ if(!user)return showLogin(); const list=Object.values(state.mistakes[user][phase]).sort((a,b)=>(b.count||0)-(a.count||0)); $("#mistakes").innerHTML=`<div class="panel wide">${phaseToggleHtml()}<h2>Mistakes</h2>${list.length?`<div class="result-grid">${list.map((word)=>`<div class="word-row"><div><strong>${escapeHtml(word.hindi)}</strong><small>${escapeHtml(formatEnglishList(word))} · ${escapeHtml(displayCategory(word.category))} · wrong ${word.count||0} · repair days ${repairDayCount(word)}/${MISTAKE_REPAIR_DAY_TARGET}${word.lastAnswer?` · last typed: ${escapeHtml(word.lastAnswer)}`:""}</small></div><small>×${word.count||0}</small></div>`).join("")}</div><button class="retry-btn" id="practiceMistakes">Practise mistakes</button>`:"<p>No mistakes yet. Enjoy the peace.</p>"}</div>`; bindPhaseButtons(); $("#practiceMistakes")?.addEventListener("click",()=>startWordSession(list,"mistakes")); }
function phaseAttempts(){ return user ? state.attempts[user][phase] || [] : []; }
function percent(correct,total){ return total ? `${Math.round((correct/total)*100)}%` : "0%"; }
function scoreSummary(name){
  const entries = state.scores[name].filter((score)=>score.phase==="phase1" && score.completed !== false);
  const total = entries.reduce((sum,score)=>sum+(score.total||0),0);
  const correct = entries.reduce((sum,score)=>sum+(score.correct||0),0);
  const best = entries.reduce((max,score)=>Math.max(max,score.correct||0),0);
  const last = entries.at(-1) || null;
  const lastSeven = entries.slice(-7);
  const average = entries.length ? Math.round(correct / entries.length) : 0;
  const recentAverage = lastSeven.length ? Math.round(lastSeven.reduce((sum,score)=>sum+(score.correct||0),0) / lastSeven.length) : 0;
  const perfectRuns = entries.filter((score)=>(score.correct||0)>=(score.total||20)).length;
  const streak = currentScoreStreak(entries);
  return { name, entries, total, correct, best, last, lastSeven, average, recentAverage, perfectRuns, streak, pct: total ? Math.round((correct/total)*100) : 0, runs: entries.length };
}
function currentScoreStreak(entries){
  let streak = 0;
  for(let i=entries.length-1;i>=0;i--){
    if((entries[i].correct||0) >= 16) streak++;
    else break;
  }
  return streak;
}
function roastFor(row, other, rank){
  if(!row.runs) return `${displayName(row.name)} has submitted zero evidence. A bold legal strategy.`;
  if(rank===0 && row.pct > other.pct) return `${displayName(row.name)} is winning, which is irritating mainly because the numbers agree.`;
  if(rank===1 && other.pct-row.pct>=10) return `${displayName(row.name)} is not losing. They are conducting a generous demonstration of what not to do.`;
  if(row.best>=20) return `${displayName(row.name)} got a perfect run. Horrible for morale, excellent for the chart.`;
  if(row.streak>=3) return `${displayName(row.name)} has a ${row.streak}-run streak. The ego has been informed and is already unbearable.`;
  if(row.recentAverage>=16) return `${displayName(row.name)} is getting annoyingly competent. Please monitor for smugness.`;
  if(row.recentAverage && row.recentAverage<10) return `${displayName(row.name)} is collecting mistakes with the confidence of someone who calls it research.`;
  return `${displayName(row.name)} remains technically present in the competition. Inspiring, in a loose sense.`;
}
function displayName(name){ return name === "maaike" ? "Maaike" : "Vincent"; }
function rivalryLine(rows){
  const [leader, chaser] = rows;
  if(!leader?.runs && !chaser?.runs) return "No scores yet. Very brave to have a scoreboard and then avoid evidence.";
  if(leader.pct===chaser.pct) return "It is tied. Nobody gets to be smug, which may be the real victory.";
  const gap = leader.pct - chaser.pct;
  return `${displayName(leader.name)} leads by ${gap} percentage point${gap===1?"":"s"}. ${displayName(chaser.name)} can still call this character building, but only just.`;
}
function scorePoint(score){ return Math.round(((score?.correct || 0) / (score?.total || 20)) * 100); }
function trendLabel(row){
  if(row.lastSeven.length < 2) return "insufficient evidence, conveniently";
  const first = row.lastSeven[0].correct || 0;
  const last = row.lastSeven.at(-1).correct || 0;
  const diff = last - first;
  if(diff > 0) return `up ${diff}. Progress. Annoying, but progress.`;
  if(diff < 0) return `down ${Math.abs(diff)}. A plot twist nobody requested.`;
  return "flat. Consistent, which is not the same as good.";
}
function sparklineSvg(row){
  const entries = row.lastSeven;
  if(!entries.length) return `<div class="chart-empty">No runs yet. The chart has chosen silence.</div>`;
  const width = 260, height = 120, pad = 14;
  const points = entries.map((score,index)=>{
    const x = entries.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (entries.length - 1);
    const y = height - pad - (scorePoint(score) / 100) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const circles = entries.map((score,index)=>{
    const [x,y] = points.split(" ")[index].split(",");
    return `<circle cx="${x}" cy="${y}" r="4"><title>${score.correct}/${score.total || 20}</title></circle>`;
  }).join("");
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${displayName(row.name)} recent scores"><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}"></line><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"></line><polyline points="${points}"></polyline>${circles}</svg>`;
}
function headToHeadHtml(rows){
  return rows.map((row)=>`<div class="bar-row"><div class="bar-label"><strong>${displayName(row.name)}</strong><span>${row.total?row.pct:0}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,row.pct)}%"></div></div></div>`).join("");
}
function recentChartHtml(rows){
  return rows.map((row)=>`<div class="trend-card"><div class="trend-head"><strong>${displayName(row.name)}</strong><span>${trendLabel(row)}</span></div>${sparklineSvg(row)}<div class="score-dots">${row.lastSeven.map((score)=>`<span title="${score.correct}/${score.total || 20}">${score.correct}</span>`).join("") || "<em>No runs</em>"}</div></div>`).join("");
}
function damageReportHtml(rows){
  const gap = rows[0]?.pct && rows[1]?.pct ? Math.abs(rows[0].pct - rows[1].pct) : 0;
  const mostPerfect = [...rows].sort((a,b)=>b.perfectRuns-a.perfectRuns)[0];
  const mostRecent = [...rows].sort((a,b)=>b.recentAverage-a.recentAverage)[0];
  return `<div class="damage-grid"><div><strong>${gap}</strong><small>point gap. Enough to mention, not enough to write a memoir.</small></div><div><strong>${mostPerfect?.perfectRuns || 0}</strong><small>perfect runs by ${mostPerfect?.runs?displayName(mostPerfect.name):"nobody"}. The bar is lying on the floor.</small></div><div><strong>${mostRecent?.recentAverage || 0}/20</strong><small>best 7-run average: ${mostRecent?.runs?displayName(mostRecent.name):"nobody yet"}.</small></div></div>`;
}
function seconds(ms){ return ms ? `${(ms/1000).toFixed(ms < 10000 ? 1 : 0)}s` : "-"; }
function challengeAttemptsFor(name){
  return (state.attempts[name]?.phase1 || []).filter((attempt)=>attempt.source==="challenge" && attempt.ms > 0);
}
function speedSummary(name){
  const attempts = challengeAttemptsFor(name);
  const correct = attempts.filter((attempt)=>attempt.correct);
  const wrong = attempts.filter((attempt)=>!attempt.correct);
  const fastest = attempts.reduce((best,attempt)=>!best || attempt.ms < best.ms ? attempt : best, null);
  const fastestCorrect = correct.reduce((best,attempt)=>!best || attempt.ms < best.ms ? attempt : best, null);
  const rushedWrong = wrong.filter((attempt)=>attempt.ms < 5000).length;
  const averageMs = attempts.length ? Math.round(attempts.reduce((sum,attempt)=>sum+attempt.ms,0)/attempts.length) : 0;
  const correctAverageMs = correct.length ? Math.round(correct.reduce((sum,attempt)=>sum+attempt.ms,0)/correct.length) : 0;
  return { name, attempts, correct, wrong, fastest, fastestCorrect, rushedWrong, averageMs, correctAverageMs };
}
function speedLine(row){
  if(!row.attempts.length) return `${displayName(row.name)} has no timed answers. Very mysterious.`;
  const fastest = row.fastestCorrect || row.fastest;
  const word = fastest ? attemptWord(fastest) : null;
  const label = fastest ? `${seconds(fastest.ms)} on ${formatEnglishList(word)}` : "no speed data";
  if(row.rushedWrong >= 3) return `${displayName(row.name)} is fast. Also wrong at speed, which is just confidence with a stopwatch. Fastest: ${label}.`;
  if(row.correctAverageMs && row.correctAverageMs < 6000) return `${displayName(row.name)} is answering before the question has emotionally settled. Fastest: ${label}.`;
  return `${displayName(row.name)} fastest useful answer: ${label}.`;
}
function speedStatsHtml(){
  const speeds = ["maaike","vincent"].map(speedSummary);
  const fastestCorrect = speeds.flatMap((row)=>row.fastestCorrect ? [{...row.fastestCorrect, name:row.name}] : []).sort((a,b)=>a.ms-b.ms)[0];
  const fastestAverage = speeds.filter((row)=>row.correctAverageMs).sort((a,b)=>a.correctAverageMs-b.correctAverageMs)[0];
  return `<div class="chart-card speed-card"><h3>Speed trials</h3><div class="speed-grid"><div><strong>${fastestCorrect?displayName(fastestCorrect.name):"-"}</strong><small>fastest correct answer${fastestCorrect?`: ${seconds(fastestCorrect.ms)}`:""}</small></div><div><strong>${fastestAverage?displayName(fastestAverage.name):"-"}</strong><small>quickest average correct${fastestAverage?`: ${seconds(fastestAverage.correctAverageMs)}`:""}</small></div><div><strong>${speeds.reduce((sum,row)=>sum+row.rushedWrong,0)}</strong><small>rushed wrong answers under 5s. Ambition, apparently.</small></div></div><div class="speed-rows">${speeds.map((row)=>`<div><span>${displayName(row.name)}</span><p>${escapeHtml(speedLine(row))}</p><small>${row.attempts.length} timed answers · avg ${seconds(row.averageMs)} · correct avg ${seconds(row.correctAverageMs)}</small></div>`).join("")}</div></div>`;
}
function attemptWord(attempt){
  return wordLookup().get(`${attempt.hindi}|${attempt.category}`) || { hindi:attempt.hindi, english:attempt.english || [], category:attempt.category };
}
function correctAnswerForAttempt(attempt){
  const word = attemptWord(attempt);
  if(attempt.mode === "type") return formatEnglishList(word);
  return word.hindi;
}
function missedWordsFromAttempts(attempts){
  return uniqueWords((Array.isArray(attempts) ? attempts : []).filter((attempt)=>!attempt.correct).map(attemptWord));
}
function todaysChallengeAttempts(name=user){
  const score = todaysChallengeScore(name);
  if(!score || !name) return [];
  const since = score.createdAt || `${today()}T00:00:00.000Z`;
  return (state.attempts[name]?.phase1 || []).filter((attempt)=>
    attempt.source === "challenge" &&
    attempt.date === today() &&
    (!attempt.createdAt || attempt.createdAt >= since)
  );
}
function missedWordCard(attempt){
  const word=attemptWord(attempt);
  return `<div class="miss-card"><div><strong>${escapeHtml(word.hindi)}</strong><small>${escapeHtml(formatEnglishList(word))} · ${escapeHtml(displayCategory(word.category))}</small></div><div class="miss-answers"><span>Correct: <b>${escapeHtml(correctAnswerForAttempt(attempt))}</b></span><span>${attempt.mode==="mc"?"Chose":"Typed"}: <b>${escapeHtml(attempt.answer || "(empty)")}</b></span></div></div>`;
}
function personMistakesHtml(name){
  const score = todaysChallengeScore(name);
  const misses = todaysChallengeAttempts(name).filter((attempt)=>!attempt.correct);
  const status = !score ? "Not done today." : score.completed ? `${score.correct || 0}/${score.total || 20} today.` : `${score.correct || 0}/${score.total || 20} so far.`;
  return `<div class="person-miss-column player-${name}"><div class="person-miss-head"><strong>${displayName(name)}</strong><span>${escapeHtml(status)}</span></div>${misses.length?`<div class="miss-list">${misses.map(missedWordCard).join("")}</div>`:`<div class="chart-empty">${score?"No wrong words here. Deeply suspicious.":"No attempt, no damage report."}</div>`}</div>`;
}
function todaysChallengeMistakesHtml(){
  return `<div class="chart-card challenge-review"><h3>Today’s missed words</h3><p>Split by person. Nobody gets blamed for somebody else’s tiny disaster.</p><div class="person-miss-grid">${["maaike","vincent"].map(personMistakesHtml).join("")}</div></div>`;
}
function scoreboardHeroHtml(rows, totalRuns, topScore, totalCorrect, totalAsked){
  const leader = rows[0];
  const chaser = rows[1];
  const gap = leader?.runs && chaser?.runs ? Math.abs(leader.pct - chaser.pct) : 0;
  return `<div class="score-hero"><div class="score-hero-copy"><div class="daily-badge">Receipts, not excuses</div><h2>Daily Challenge Scoreboard</h2><p>${escapeHtml(rivalryLine(rows))}</p></div><div class="leader-tile"><span>Current menace</span><strong>${leader?.runs?displayName(leader.name):"-"}</strong><small>${leader?.runs?`${leader.pct}% accuracy · ${gap} point gap`:"No winner. Just potential."}</small></div><div class="score-stats-grid hero-stats"><div class="stat-box"><strong>${totalRuns}</strong><small>total runs</small></div><div class="stat-box"><strong>${topScore}/20</strong><small>best single run</small></div><div class="stat-box"><strong>${percent(totalCorrect,totalAsked)}</strong><small>combined accuracy</small></div><div class="stat-box"><strong>${leader?.recentAverage || 0}/20</strong><small>leader 7-run avg</small></div></div></div>`;
}
function dateOffsetKey(offset){
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0,10);
}
function shortDateLabel(date){
  return displayDate(date);
}
function scoreByDate(row, date){
  return row.entries.filter((score)=>score.date===date).at(-1) || null;
}
function todayScoreFor(name){
  return state.scores[name].filter((score)=>score.phase==="phase1" && score.date===today()).at(-1) || null;
}
function todayStatus(name){
  const score = todayScoreFor(name);
  if(!score) return "Today: not done";
  if(!score.completed) return `Today: in progress (${score.correct || 0}/${score.total || 20})`;
  return `Today: ${score.correct || 0}/${score.total || 20}`;
}
function podiumHtml(rows){
  return `<div class="podium-grid">${rows.map((row,index)=>`<div class="podium-card ${index===0?"podium-leader":""} player-${row.name}"><div class="medal">${index+1}</div><h3>${displayName(row.name)}</h3><strong>${row.correct}</strong><span>total points</span><small>${escapeHtml(todayStatus(row.name))}</small></div>`).join("")}</div>`;
}
function scoreboardTopHtml(rows, totalRuns, topScore, totalCorrect, totalAsked){
  return `<div class="scoreboard-top"><div><div class="daily-badge">Receipts, not excuses</div><h2>Scoreboard</h2><p>${escapeHtml(rivalryLine(rows))}</p></div><div class="score-stats-grid scoreboard-kpis"><div class="stat-box"><strong>${totalRuns}</strong><small>days played</small></div><div class="stat-box"><strong>${topScore}/20</strong><small>best day</small></div><div class="stat-box"><strong>${percent(totalCorrect,totalAsked)}</strong><small>combined accuracy</small></div><div class="stat-box"><strong>${rows[0]?.runs?displayName(rows[0].name):"-"}</strong><small>current leader</small></div></div></div>`;
}
function quoteCardHtml(rows){
  return `<div class="score-quote"><p>"${escapeHtml(rivalryLine(rows))}"</p></div>`;
}
function last14ChartHtml(rows){
  const days = Array.from({length:14},(_,index)=>dateOffsetKey(index-13));
  const width = 900, height = 260, padX = 42, padY = 34;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const series = rows.map((row)=>({
    ...row,
    points: days.map((date,index)=>{
      const score = scoreByDate(row,date);
      const value = score?.correct || 0;
      const x = padX + (index * plotW) / (days.length - 1);
      const y = height - padY - (Math.min(20,value) / 20) * plotH;
      return { date, value, x, y };
    })
  }));
  const grid = [0,5,10,15,20].map((value)=>{
    const y = height - padY - (value / 20) * plotH;
    return `<line class="score-gridline" x1="${padX}" y1="${y}" x2="${width-padX}" y2="${y}"></line><text class="axis-label" x="8" y="${y+4}">${value}</text>`;
  }).join("");
  const lines = series.map((row)=>`<polyline class="day-line line-${row.name}" points="${row.points.map((point)=>`${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}"></polyline>${row.points.map((point)=>`<circle class="day-dot dot-${row.name}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.value?5:3}"><title>${displayName(row.name)} ${shortDateLabel(point.date)}: ${point.value}/20</title></circle>`).join("")}`).join("");
  const labels = days.map((date,index)=>`<text class="date-label" x="${(padX + (index * plotW) / (days.length - 1)).toFixed(1)}" y="${height-8}">${shortDateLabel(date)}</text>`).join("");
  return `<div class="chart-card fourteen-card"><div class="chart-heading"><h3>Last 14 days</h3><span>Daily points out of 20. Empty days get the dignified score of zero.</span></div><svg class="fourteen-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Last 14 days daily challenge scores">${grid}${lines}${labels}</svg><div class="chart-legend">${rows.map((row)=>`<span class="legend-${row.name}"><b></b>${displayName(row.name)}</span>`).join("")}</div></div>`;
}
function scoreTableHtml(rows){
  return `<div class="score-table-card"><table class="score-table"><thead><tr><th>Player</th><th>Days played</th><th>Total pts</th><th>Avg / day</th><th>Best</th><th>Accuracy</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><strong>${displayName(row.name)}</strong></td><td>${row.runs}</td><td>${row.correct}</td><td>${row.runs?row.average:"-"}</td><td>${row.best || "-"}</td><td>${row.total?row.pct+"%":"-"}</td></tr>`).join("")}</tbody></table></div>`;
}
function wordLookup(){
  return new Map(phaseWords().map((word)=>[keyFor(word), word]));
}
function wordsFromAttempts(attempts){
  const current = wordLookup();
  const words = new Map();
  attempts.filter((item)=>!item.correct).forEach((item)=>{
    const key = `${item.hindi}|${item.category}`;
    words.set(key, current.get(key) || { hindi:item.hindi, english:item.english || [], category:item.category });
  });
  return [...words.values()].filter((word)=>word.hindi && word.english.length);
}
function weekSummaries(){
  const groups = new Map();
  phaseAttempts().forEach((attempt)=>{
    const week = attemptWeek(attempt);
    if(!groups.has(week)) groups.set(week,{week,total:0,correct:0,wrong:0,words:new Map()});
    const group = groups.get(week);
    group.total++;
    attempt.correct ? group.correct++ : group.wrong++;
    const key = `${attempt.hindi}|${attempt.category}`;
    if(!group.words.has(key)) group.words.set(key,{wrong:0,correct:0,lastCorrect:false,attempts:[]});
    const word = group.words.get(key);
    attempt.correct ? word.correct++ : word.wrong++;
    word.lastCorrect = Boolean(attempt.correct);
    word.attempts.push(attempt);
  });
  return [...groups.values()].sort((a,b)=>b.week.localeCompare(a.week)).map((group)=>{
    const words = [...group.words.values()];
    return {
      ...group,
      mistakeWords: words.filter((word)=>word.wrong>0).length,
      improvedWords: words.filter((word)=>word.wrong>0 && word.lastCorrect).length,
      stillWrongWords: words.filter((word)=>word.wrong>0 && !word.lastCorrect).length
    };
  });
}
function renderStats(){
  if(!user)return showLogin();
  const attempts = phaseAttempts();
  const correct = attempts.filter((item)=>item.correct).length;
  const wrong = attempts.length - correct;
  const currentWeek = weekKey();
  const weeks = weekSummaries();
  const thisWeek = weeks.find((item)=>item.week===currentWeek) || {total:0,correct:0,wrong:0,mistakeWords:0,improvedWords:0,stillWrongWords:0};
  const activeMistakes = Object.values(state.mistakes[user][phase]).length;
  $("#stats").innerHTML = `<div class="panel wide">${phaseToggleHtml()}<h2>Stats</h2><div class="stats-grid"><div class="stat-box"><strong>${percent(correct,attempts.length)}</strong><small>all-time accuracy</small></div><div class="stat-box"><strong>${attempts.length}</strong><small>answers saved</small></div><div class="stat-box"><strong>${activeMistakes}</strong><small>active mistake words</small></div><div class="stat-box"><strong>${percent(thisWeek.correct,thisWeek.total)}</strong><small>this week</small></div></div>${weeks.length?`<div class="week-list">${weeks.map((week)=>`<div class="week-card"><div><strong>Week of ${displayDate(week.week)}</strong><small>${week.total} answers · ${week.wrong} wrong · ${week.mistakeWords} mistake words · ${week.improvedWords} improved</small></div><button class="ghost week-practice" data-week="${week.week}" type="button">Practise week mistakes</button></div>`).join("")}</div>`:`<p>No saved answers yet. Log in and practise to build weekly stats.</p>`}</div>`;
  bindPhaseButtons();
  document.querySelectorAll("[data-week]").forEach((button)=>button.addEventListener("click",()=>{
    const words = wordsFromAttempts(phaseAttempts().filter((attempt)=>attemptWeek(attempt)===button.dataset.week));
    startWordSession(words,"weekly");
  }));
}
function renderScoreboard(){
  if(!user)return showLogin();
  const rows=["maaike","vincent"].map(scoreSummary).sort((a,b)=>b.pct-a.pct||b.best-a.best||b.correct-a.correct);
  const totalRuns = rows.reduce((sum,row)=>sum+row.runs,0);
  const topScore = rows.reduce((max,row)=>Math.max(max,row.best),0);
  const totalCorrect = rows.reduce((sum,row)=>sum+row.correct,0);
  const totalAsked = rows.reduce((sum,row)=>sum+row.total,0);
  $("#scoreboard").innerHTML=`<div class="panel wide scoreboard-panel">${scoreboardTopHtml(rows,totalRuns,topScore,totalCorrect,totalAsked)}${podiumHtml(rows)}${quoteCardHtml(rows)}${last14ChartHtml(rows)}${scoreTableHtml(rows)}<div class="score-charts detail-charts"><div class="chart-card"><h3>Head-to-head</h3>${headToHeadHtml(rows)}</div><div class="chart-card wide-chart"><h3>Last 7 runs</h3><div class="trend-grid">${recentChartHtml(rows)}</div></div><div class="chart-card wide-chart"><h3>Damage report</h3>${damageReportHtml(rows)}</div>${speedStatsHtml()}${todaysChallengeMistakesHtml()}</div></div>`;
}
function renderManage(){ if(user!=="maaike")return show("quiz"); $("#manage").innerHTML=`<div class="panel wide">${phaseToggleHtml()}<h2>Manage vocabulary</h2><div class="actions"><button class="ghost" id="syncPhase1" type="button">Sync Phase 1 from Google Sheet</button><button class="ghost" id="syncPhase2" type="button">Sync Phase 2 from Google Sheet</button><span id="syncStatus" style="color:var(--text-secondary);font-size:.85rem;align-self:center"></span></div><input id="search" type="search" placeholder="Search"><div style="overflow:auto"><table class="table"><thead><tr><th>Hindi</th><th>English</th><th>Category</th></tr></thead><tbody id="wordRows"></tbody></table></div></div>`; bindPhaseButtons(); $("#syncPhase1").addEventListener("click", syncPhase1FromSheet); $("#syncPhase2").addEventListener("click", syncPhase2FromSheet); const renderRows=()=>{const q=normEnglish($("#search").value); $("#wordRows").innerHTML=state.words[phase].map((word,index)=>({word,index})).filter(({word})=>!q||normEnglish(word.hindi+" "+word.english.join(" ")+word.category).includes(q)).map(({word,index})=>`<tr><td class="hindi-cell" contenteditable data-i="${index}" data-field="hindi">${word.hindi}</td><td contenteditable data-i="${index}" data-field="english">${word.english.join("; ")}</td><td contenteditable data-i="${index}" data-field="category">${word.category}</td></tr>`).join(""); document.querySelectorAll("[contenteditable]").forEach((cell)=>cell.addEventListener("blur",()=>{const word=state.words[phase][Number(cell.dataset.i)]; word[cell.dataset.field]=cell.dataset.field==="english"?cell.textContent.split(";").map(x=>x.trim()).filter(Boolean):cell.textContent.trim(); save();}));}; $("#search").addEventListener("input",renderRows); renderRows(); }
function showLogin(){ renderLogin(); show("login"); }
function renderLogin(){ $("#login").innerHTML=`<div class="login-card"><h2>Log in</h2><p>Daily Coach, scoreboard and personal mistakes.</p><input id="username" type="text" placeholder="Username"><input id="password" type="password" placeholder="Password"><button class="login-btn" id="doLogin">Log in</button><p id="loginError" style="color:var(--red);min-height:22px;margin-top:10px"></p></div>`; $("#doLogin").addEventListener("click",()=>{const name=$("#username").value.trim().toLowerCase(); const pass=$("#password").value; if(USERS[name] && USERS[name]===pass){user=name; if(user==="vincent") phase="phase1"; save(); renderNav(); show("coach");} else $("#loginError").textContent="Incorrect username or password.";}); }
document.querySelectorAll("[data-screen]").forEach((button)=>button.addEventListener("click",()=>show(button.dataset.screen)));
$("#loginBtn").addEventListener("click",()=>{renderLogin(); show("login");});
$("#logoutBtn").addEventListener("click",()=>{user=null; save(); renderNav(); show("quiz");});
window.addEventListener("popstate",()=>{
  if(session?.source==="challenge"){
    lockChallengeNavigation();
    renderQuestion();
  }
});
window.addEventListener("beforeunload",(event)=>{
  if(session?.source!=="challenge") return;
  updateChallengeScore(false);
  pushCloudState();
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("visibilitychange",()=>{
  if(CLOUD_SYNC_ENABLED && document.visibilityState === "visible" && user) loadCloudState({ rerender:true });
});
if(CLOUD_SYNC_ENABLED) setInterval(()=>{ if(user && !session) loadCloudState({ rerender:true }); }, 60000);
renderNav();
if(user) show("coach");
else renderQuizSetup();
autoSyncPublishedSheets();
initCloudSync().then(()=>loadCloudState({ rerender:true }));
