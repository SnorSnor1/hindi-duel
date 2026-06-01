import { PHASE_DATA } from "./data.js";

const USERS = { maaike: "Maaike10!", vincent: "chailavie" };
const STORE = "hindi.seekho.combined.v1";
const FIREBASE_CONFIG = window.HINDI_DUEL_FIREBASE_CONFIG || null;
const FIREBASE_STATE_PATH = "hindiDuel/sharedState";
const CLOUD_SYNC_ENABLED = Boolean(FIREBASE_CONFIG);
const PHASE1_SHEET_URL = "https://docs.google.com/spreadsheets/d/1cBDf3LfWuA50xTL5N_-A1YUIWmkjWMl9JWJIkq9RYs4/export?format=csv&gid=0";
const PHASE2_SHEET_URL = "https://docs.google.com/spreadsheets/d/14BD6b5P1dCkUB9pouUzWuQsN6woZyNpPOkKihyngKHo/export?format=csv&gid=1937597985";
const DAILY_PHASE2_TARGET = 15;
const DAILY_MISTAKE_TARGET = 10;
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
const phaseWords = () => state.words[phase].filter((word) => word.english.length);
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
function splitAnswers(...values){
  return values.flatMap((value)=>String(value || "").split(/[;,/]/)).map((item)=>item.trim()).filter(Boolean);
}
async function fetchPhase1WordsFromSheet(){
  const response = await fetch(PHASE1_SHEET_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Phase 1 Sheet is not accessible.");
  const rows = parseCsv(await response.text()).slice(1);
  return rows.map((cells,index)=>({
    hindi: String(cells[0] || "").replace(/\s+/g," ").trim(),
    english: String(cells[1] || "").split(";").map((item)=>item.trim()).filter(Boolean),
    category: categoryForPhase1Row(index + 2)
  })).filter((word)=>word.hindi && word.english.length);
}
async function fetchPhase2WordsFromSheet(){
  const response = await fetch(PHASE2_SHEET_URL, { cache: "no-store" });
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
function activeMistakesFor(name, phaseKey){
  return Object.values(state.mistakes[name]?.[phaseKey] || {}).filter((word)=>word.hindi && word.english?.length);
}
function allActiveMistakes(name){
  return ["phase1","phase2"].flatMap((phaseKey)=>activeMistakesFor(name, phaseKey).map((word)=>({ ...word, phaseKey })));
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
function scoreTaskStatus(name){
  const score = todaysChallengeScore(name);
  const target = score?.total || 20;
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
  const target = Math.min(DAILY_MISTAKE_TARGET, active.length);
  const progress = allAttemptsToday(name).filter((attempt)=>attempt.source==="coach-mistakes").length;
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
function phase2TaskStatus(name){
  const available = (state.words.phase2 || []).filter((word)=>word.english?.length);
  const target = name === "maaike" ? Math.min(DAILY_PHASE2_TARGET, available.length) : 0;
  const progress = attemptsToday(name, "phase2").length;
  return {
    id: "phase2",
    title: "Phase 2 focus",
    done: target === 0 || progress >= target,
    progress,
    target,
    categories: latestPhaseCategories("phase2", 3),
    label: taskProgressLabel(progress, target, "Not needed")
  };
}
function dailyContractFor(name=user){
  const tasks = [scoreTaskStatus(name), mistakeTaskStatus(name), phase2TaskStatus(name)];
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
  return `<div class="coach-task ${task.done?"task-done":"task-open"}"><div class="task-head"><div><span>${escapeHtml(task.title)}</span><strong>${escapeHtml(task.label)}</strong></div><b>${task.done?"Done":"Due"}</b></div>${body}${actionHtml}</div>`;
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
  const body = `<p>Fixed Phase 1 run. One attempt per day, timed, saved to the scoreboard.</p>`;
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
  const body = `<p>${task.target ? `${task.active.length} active mistake words. Repair ${task.target} today.` : "No active mistake words right now."}</p>`;
  const action = task.target
    ? `<div class="coach-actions"><button class="ghost" id="startCoachMistakes1" type="button" ${phase1Count?"":"disabled"}>Phase 1 mistakes (${phase1Count})</button><button class="ghost" id="startCoachMistakes2" type="button" ${phase2Count?"":"disabled"}>Phase 2 mistakes (${phase2Count})</button></div>`
    : "";
  return taskCardHtml(task, body, action);
}
function coachPhase2Html(task){
  const lessons = task.categories.length ? task.categories.map(displayCategory).join(", ") : "No Phase 2 words";
  const body = `<p>Newest lessons: ${escapeHtml(lessons)}.</p>`;
  const action = task.target
    ? `<button class="start-btn" id="startCoachPhase2" type="button">Start Phase 2 focus</button>`
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
  $("#coach").innerHTML = `<div class="coach-shell">${notice}${coachHeroHtml(contract)}<div class="coach-grid">${coachChallengeHtml(tasks.challenge)}${coachMistakesHtml(tasks.mistakes)}${coachPhase2Html(tasks.phase2)}</div>${coachProofHtml(contract)}${user==="maaike"?maintenanceHtml():""}</div>`;
  $("#startCoachChallenge")?.addEventListener("click",async()=>{ await loadCloudState({ rerender:false }); phase="phase1"; selectedCategories=new Set(categories()); startSession("challenge",20,"mixed"); });
  $("#coachChallengeReview")?.addEventListener("click",()=>show("challenge"));
  $("#startCoachPhase2")?.addEventListener("click",()=>startPhase2Focus());
  $("#startCoachMistakes1")?.addEventListener("click",()=>startCoachMistakes("phase1"));
  $("#startCoachMistakes2")?.addEventListener("click",()=>startCoachMistakes("phase2"));
  $("#openManage")?.addEventListener("click",()=>show("manage"));
  $("#coachSyncPhase1")?.addEventListener("click",()=>syncPhase1FromSheet($("#coachSyncStatus")));
  $("#coachSyncPhase2")?.addEventListener("click",()=>syncPhase2FromSheet($("#coachSyncStatus")));
  $("#saveLessonPrep")?.addEventListener("click",()=>{ state.maintenance = normalizeMaintenance(state.maintenance); state.maintenance.lessonPrep = { ...state.maintenance.lessonPrep, nextLessonAt: isoFromDateTimeInput($("#nextLessonAt").value), checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; save({ immediate:true }); renderCoach(); });
}
function startPhase2Focus(){
  phase = "phase2";
  selectedCategories = new Set(latestPhaseCategories("phase2", 3));
  if(!selectedCategories.size) selectedCategories = new Set(categories());
  save();
  const target = phase2TaskStatus(user).target || DAILY_PHASE2_TARGET;
  startSession("coach-phase2", target, "mixed");
}
function startCoachMistakes(phaseKey){
  const words = activeMistakesFor(user, phaseKey);
  if(!words.length) return renderCoach();
  phase = phaseKey;
  selectedCategories = new Set(words.map((word)=>word.category));
  save();
  startWordSession(words.slice(0, DAILY_MISTAKE_TARGET), "coach-mistakes");
}
function renderQuizSetup(){
  if(!selectedCategories.size) selectedCategories = new Set(categories());
  $("#quiz").innerHTML = `<div class="setup-card">${phaseToggleHtml()}<h2>${PHASE_DATA[phase].title}</h2><label class="form-label">Mode</label><div class="mode-toggle"><button class="${mode==="mixed"?"selected":""}" data-mode="mixed">Mixed</button><button class="${mode==="type"?"selected":""}" data-mode="type">Hindi → English</button><button class="${mode==="mc"?"selected":""}" data-mode="mc">English → Hindi</button></div><label class="form-label">Categories</label>${renderCategoryChips()}<label class="form-label">Words</label><input id="wordCount" type="number" min="1" max="200" value="20"><button class="start-btn" id="startPractice">Start practice</button></div>`;
  bindPhaseButtons(); bindCategoryChips();
  document.querySelectorAll("[data-mode]").forEach((button)=>button.addEventListener("click",()=>{mode=button.dataset.mode; renderQuizSetup();}));
  $("#startPractice").addEventListener("click",()=>startSession("practice", Number($("#wordCount").value||20)));
}
function startSession(source, count=20, forcedMode=mode){
  if(source==="challenge" && todaysChallengeScore()) return show("challenge");
  const pool = phaseWords().filter((word)=>selectedCategories.has(word.category));
  const queue = shuffle([...pool]).slice(0, Math.min(count, pool.length));
  session = { source, queue, index:0, correct:0, wrong:0, approved:0, mode:forcedMode, started:0, modes:[] };
  if(source==="challenge"){
    session.modes = queue.map(()=>Math.random()>.5?"type":"mc");
    session.score = createChallengeScore(queue.length);
    lockChallengeNavigation();
  }
  renderQuestion();
}
function startWordSession(words, source="practice"){
  if(!words.length) return;
  session = { source, queue:shuffle([...words]), index:0, correct:0, wrong:0, approved:0, mode:"mixed", started:0, modes:[] };
  show("quiz");
  renderQuestion();
}
function renderQuestion(){
  clearTimer();
  clearNextKeyHandler();
  if(!session || session.index>=session.queue.length) return finishSession();
  session.awaitingNext = false;
  const word = session.queue[session.index];
  const qMode = session.source==="challenge" ? session.modes[session.index] : (session.mode==="mixed" ? (Math.random()>.5?"type":"mc") : session.mode);
  session.currentMode = qMode; session.started = performance.now();
  const progress = Math.round((session.index/session.queue.length)*100);
  $("#quiz").classList.remove("hidden"); screens.filter(id=>id!=="quiz").forEach(id=>$("#"+id).classList.add("hidden"));
  $("#quiz").innerHTML = `<div class="quiz-active">${session.source==="challenge"?timerHtml():""}<div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div><div class="score-display">${session.index+1}/${session.queue.length} · ${session.correct} correct</div><div class="quiz-card">${qMode==="type"?typeHtml(word):mcHtml(word)}<div id="feedback" class="feedback"></div><div id="feedbackButtons" class="feedback-buttons"></div></div></div>`;
  if(qMode==="type"){ $("#answerInput").focus(); $("#answerForm").addEventListener("submit",(event)=>{event.preventDefault(); answerType(word);}); }
  else bindMc(word);
  if(session.source==="challenge") startTimer(qMode==="type"?20:12);
}
function timerHtml(){ return `<div class="timer"><div class="timer-row"><span>Daily timer</span><strong id="timerNum"></strong></div><div class="timer-bar"><div id="timerFill" class="timer-fill"></div></div></div>`; }
function typeHtml(word){ return `<div class="hindi-word">${word.hindi}</div><form id="answerForm" class="answer-form"><input id="answerInput" class="answer-input" autocomplete="off" placeholder="Type in English"><button class="check-btn" type="submit">Check</button></form>`; }
function mcHtml(word){ const choices=makeChoices(word); return `<div class="english-word">${escapeHtml(formatPrimaryEnglish(word))}</div><div class="mc-options">${choices.map((choice)=>`<button class="mc-btn" type="button">${escapeHtml(choice.hindi)}</button>`).join("")}</div>`; }
function makeChoices(word){ const others=phaseWords().filter((candidate)=>normHindi(candidate.hindi)!==normHindi(word.hindi)); return shuffle([word,...shuffle(others).slice(0,3)]); }
function bindMc(word){ document.querySelectorAll(".mc-btn").forEach((button)=>button.addEventListener("click",()=>answerMc(word, button))); }
function answerType(word){ const answer=$("#answerInput").value.trim(); const result=checkAnswer(answer, word.english); completeAnswer(word,result.correct,result.close,answer); }
function answerMc(word, button){ const correct=normHindi(button.textContent)===normHindi(word.hindi); document.querySelectorAll(".mc-btn").forEach((btn)=>{btn.disabled=true; if(normHindi(btn.textContent)===normHindi(word.hindi)) btn.classList.add("correct"); else if(btn===button) btn.classList.add("wrong"); else btn.classList.add("dimmed");}); completeAnswer(word, correct, false, button.textContent); }
function correctTypeAnswerHtml(word){
  return `<div class="answer-reveal answer-reveal-big answer-reveal-type"><span>Correct answer</span><strong>${escapeHtml(formatEnglishList(word))}</strong><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}</div>`;
}
function correctTranslationHtml(word){
  return `<div class="answer-reveal answer-reveal-big"><span>Correct translation</span><strong class="answer-pair"><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}<em>${escapeHtml(formatEnglishList(word))}</em></strong></div>`;
}
function correctTypeSuccessHtml(word, close){
  return `<div class="answer-reveal answer-reveal-big answer-reveal-type answer-reveal-success"><span>${close ? "Accepted answer" : "Correct answer"}</span><strong>${escapeHtml(formatEnglishList(word))}</strong><b>${escapeHtml(word.hindi)}</b>${romanizedHindiHtml(word)}</div>`;
}
function completeAnswer(word, correct, close, answer=""){
  if(!session || session.awaitingNext) return;
  session.awaitingNext = true;
  clearTimer();
  $("#answerInput")?.setAttribute("disabled", "true");
  $("#answerForm button")?.setAttribute("disabled", "true");
  document.querySelectorAll(".mc-btn").forEach((button)=>button.disabled = true);
  if(correct) session.correct++;
  else session.wrong++;
  updateChallengeScore(false);

  const attemptId=recordAttempt(word, correct, close, answer);
  const fb=$("#feedback");
  const isTyping = session.currentMode === "type";
  const successLine = correct&&isTyping
    ? correctTypeSuccessHtml(word, close)
    : "";
  const answerLine = !correct
    ? (isTyping ? correctTypeAnswerHtml(word) : correctTranslationHtml(word))
    : "";
  const typedLine = !correct&&isTyping
    ? `<div class="typed-answer"><span>You typed</span><strong>${escapeHtml(answer || "(empty)")}</strong></div>`
    : "";
  const selectedLine = !correct&&!isTyping
    ? `<div class="typed-answer"><span>You chose</span><strong>${escapeHtml(answer || "(empty)")}</strong></div>`
    : "";
  const canApprove = !correct && session.source !== "challenge";
  const requiresReview = !correct && session.source === "challenge";

  fb.className=`feedback ${correct?(close?"close":"good"):"bad"}`;
  fb.innerHTML=correct
    ? (successLine || (close?`Accepted <small>${escapeHtml(formatPrimaryEnglish(word))}</small>`:`Correct <small>${escapeHtml(formatPrimaryEnglish(word))}</small>`))
    : `${answerLine}${typedLine}${selectedLine}`;
  $("#feedbackButtons").innerHTML=`${canApprove?'<button class="btn-approve" id="approveBtn">Count as correct</button>':""}<button class="btn-next" id="nextBtn" ${requiresReview?"disabled":""}>Next →</button>`;
  const nextButton = $("#nextBtn");
  if(requiresReview) setTimeout(()=>{ if(nextButton){ nextButton.disabled = false; nextButton.focus(); } }, CHALLENGE_REVIEW_MS);
  else nextButton?.focus();
  nextButton?.addEventListener("click", nextQuestion);
  $("#approveBtn")?.addEventListener("click",()=>{session.correct++; session.wrong--; session.approved++; approveAttempt(attemptId, word); $("#approveBtn").remove();});
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
function recordAttempt(word, correct, close, answer){
  if(!user) return null;
  const createdAt = new Date().toISOString();
  const attempt = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: createdAt.slice(0,10),
    week: weekKey(createdAt),
    phase,
    source: session?.source || "practice",
    mode: session?.currentMode || mode,
    hindi: word.hindi,
    english: [...word.english],
    category: word.category,
    answer: String(answer || "").trim(),
    correct: Boolean(correct),
    close: Boolean(close),
    approved: false,
    ms: session?.started ? Math.max(0, Math.round(performance.now() - session.started)) : 0
  };
  state.attempts[user][phase].push(attempt);
  state.attempts[user][phase] = state.attempts[user][phase].slice(-2500);
  updateMistakeStatus(word, correct, answer);
  save();
  return attempt.id;
}
function updateMistakeStatus(word, correct, answer){
  const bucket=state.mistakes[user][phase];
  const key=keyFor(word);
  if(correct){
    if(bucket[key]){
      bucket[key].streak=(bucket[key].streak||0)+1;
      bucket[key].lastCorrectAt=new Date().toISOString();
    }
    return;
  }
  bucket[key]={...word,count:(bucket[key]?.count||0)+1,streak:0,lastWrongAt:new Date().toISOString(),lastAnswer:String(answer||"").trim()};
}
function approveAttempt(id, word){
  if(!user || !id) return;
  const attempt=state.attempts[user][phase].find((item)=>item.id===id);
  if(attempt){ attempt.correct=true; attempt.approved=true; }
  const bucket=state.mistakes[user][phase];
  const key=keyFor(word);
  if(bucket[key]){
    bucket[key].count=Math.max(0,(bucket[key].count||1)-1);
    if(bucket[key].count===0) delete bucket[key];
  }
  save();
}
function clearTimer(){ if(timer){clearInterval(timer); timer=null;} }
function startTimer(seconds){ let remaining=seconds; $("#timerNum").textContent=remaining+"s"; $("#timerFill").style.width="100%"; timer=setInterval(()=>{remaining--; $("#timerNum").textContent=remaining+"s"; $("#timerFill").style.width=Math.max(0,(remaining/seconds)*100)+"%"; if(remaining<=0){clearTimer(); completeAnswer(session.queue[session.index],false,false);}},1000); }
function finishSession(){
  clearTimer();
  const finished = session;
  if(finished.source==="challenge" && user){
    updateChallengeScore(true);
    pushCloudState();
    session=null;
    renderNav();
    show("coach");
    return;
  }
  const returnsToCoach = String(finished.source || "").startsWith("coach-");
  $("#quiz").innerHTML=`<div class="panel"><h2>Session complete</h2><div class="result-grid"><div class="stat-box"><strong>${finished.correct}/${finished.queue.length}</strong><br><small>correct</small></div><div class="stat-box"><strong>${Math.round((finished.correct/finished.queue.length)*100)}%</strong><br><small>score</small></div></div><button class="retry-btn" id="backToPractice" type="button">${returnsToCoach?"Back to coach":"Back to practice"}</button></div>`;
  session=null;
  renderNav();
  $("#backToPractice")?.addEventListener("click",()=>show(returnsToCoach ? "coach" : "quiz"));
}
function challengeReviewHtml(){
  const misses = todaysChallengeAttempts().filter((attempt)=>!attempt.correct);
  const title = misses.length ? `Words to review (${misses.length})` : "Words to review";
  return `<div class="daily-review"><div class="daily-review-title">${escapeHtml(title)}</div>${misses.length?`<div class="miss-list">${misses.map(missedWordCard).join("")}</div>`:`<div class="chart-empty">No mistakes today. Annoying, but impressive.</div>`}</div>`;
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
  const total = done?.total || 20;
  $("#challenge").innerHTML=`<div class="challenge-card daily-card"><div class="daily-badge">Phase 1 daily</div><h2>Daily Challenge</h2><p class="challenge-date">${displayDate(today())}</p><div class="daily-metrics"><div><strong>20</strong><small>words</small></div><div><strong>20s</strong><small>typing</small></div><div><strong>12s</strong><small>choices</small></div><div><strong>${recent.length?best:"-"}</strong><small>7-run best</small></div></div><p class="challenge-info">A fixed daily run with random Phase 1 words. Once you start, today’s attempt is locked.</p>${done?`<div class="daily-result"><span>${doneLabel}</span><strong>${done.correct}/${total}</strong><small>${Math.round(((done.correct||0)/total)*100)}% ${doneNote} · 7-run average ${average || 0}/20</small></div>${done.completed?challengeReviewHtml():""}<div class="daily-actions"><button class="retry-btn secondary-action" id="practiceAfterChallenge" type="button">Practise Phase 1</button><button class="retry-btn" id="goScoreboard" type="button">Go to scoreboard</button></div>`:`<button class="start-btn daily-start" id="startChallenge" type="button">Start today’s challenge</button>`}</div>`;
  $("#startChallenge")?.addEventListener("click",async()=>{ await loadCloudState({ rerender:false }); startSession("challenge",20,"mixed"); });
  $("#practiceAfterChallenge")?.addEventListener("click",()=>show("quiz"));
  $("#goScoreboard")?.addEventListener("click",()=>show("scoreboard"));
}
function renderMistakes(){ if(!user)return showLogin(); const list=Object.values(state.mistakes[user][phase]).sort((a,b)=>(b.count||0)-(a.count||0)); $("#mistakes").innerHTML=`<div class="panel wide">${phaseToggleHtml()}<h2>Mistakes</h2>${list.length?`<div class="result-grid">${list.map((word)=>`<div class="word-row"><div><strong>${escapeHtml(word.hindi)}</strong><small>${escapeHtml(formatEnglishList(word))} · ${escapeHtml(displayCategory(word.category))} · wrong ${word.count||0} · correct streak ${word.streak||0}${word.lastAnswer?` · last typed: ${escapeHtml(word.lastAnswer)}`:""}</small></div><small>×${word.count||0}</small></div>`).join("")}</div><button class="retry-btn" id="practiceMistakes">Practise mistakes</button>`:"<p>No mistakes yet. Enjoy the peace.</p>"}</div>`; bindPhaseButtons(); $("#practiceMistakes")?.addEventListener("click",()=>startWordSession(list,"mistakes")); }
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
  return attempt.mode === "type" ? formatEnglishList(word) : word.hindi;
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
  return `<div class="miss-card"><div><strong>${escapeHtml(word.hindi)}</strong><small>${escapeHtml(formatEnglishList(word))} · ${escapeHtml(displayCategory(word.category))}</small></div><div class="miss-answers"><span>Correct: <b>${escapeHtml(correctAnswerForAttempt(attempt))}</b></span><span>${attempt.mode==="type"?"Typed":"Chose"}: <b>${escapeHtml(attempt.answer || "(empty)")}</b></span></div></div>`;
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
