// A practical, editorial selection from the existing lessons.
// Themes follow beginner communication needs, rather than a corpus frequency ranking.
export const CORE_THEMES = [
  { id:"people", label:"People & family", words:[
    "मैं","तुम","आप","हम","वो","लोग","आदमी","औरत","लड़का","लड़की","बच्चा",
    "मम्मी","पापा","पति","पत्नी","बेटा","बेटी","दोस्त","सहेली","मेहमान"
  ] },
  { id:"questions", label:"Questions & conversation", words:[
    "क्या ?","कौन ?","कहाँ ?","कब?","क्यों ?","कैसे ?","कितने ?","कौन सा?","कौन सी?",
    "कितनी दूर?","किसका?","क्या हाल है?","दोबारा बोलिए","थोड़ा धीरे बोलिए",
    "थोड़ा साफ़ बोलिए","भाषा","सवाल","बताना","कहना","समझाना","माफ़ी माँगना"
  ] },
  { id:"verbs", label:"Everyday actions", words:[
    "जाना","आना","बैठना","खड़े होना","चलना","रुकना","देना","लेना","रखना","देखना",
    "सुनना","पढ़ना","लिखना","काम करना","सोना","जागना","खोलना","बंद करना",
    "इंतज़ार करना","इस्तेमाल करना","सोचना","ढूंढना","कोशिश करना","चुनना","खरीदना",
    "बेचना","लाना","ले जाना","छोड़ना","पहुंचना","लौटना","बदलना","पता चलना"
  ] },
  { id:"food", label:"Food & drink", words:[
    "पानी","चाय","दूध","कॉफी","पीना","खाना","रोटी","चावल","दाल","सब्ज़ी","फल",
    "नमक","चीनी","अंडा","आलू","केला","सेब","पकाना","ग्लास","कप","चम्मच","तेल"
  ] },
  { id:"needs", label:"Needs, health & help", words:[
    "भूख लगना","प्यास लगना","थकना","नींद आना","दर्द होना","बीमारी","दवाई","डॉक्टर",
    "अस्पताल","मदद करना","मदद मांगना","चाहिए","ज़रूरत","ज़रूरी","चाहते",
    "चाहते है","तबियत खराब होना","खतरनाक","रास्ता भूलना","ध्यान रखना","तकलीफ़"
  ] },
  { id:"time", label:"Numbers & time", words:[
    "एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ","दस","बीस","सौ",
    "आज","कल था","कल होगा","हफ़्ता","महीना","साल","समय","वक्त","जल्दी से",
    "देर होना","अभी भी","अक्सर","हमेशा","रोज़ाना"
  ] },
  { id:"places", label:"Places & getting around", words:[
    "आगे","पीछे","ऊपर","नीचे","अंदर","पास","दूर","रास्ता","सड़क","शहर","गाँव",
    "गाड़ी","टिकट काउंटर","रेलवे स्टेशन","हवाई अड्डा","होटल","बैंक","बाथरूम",
    "दरवाज़ा","फोन","किताब","पैदल","सफ़र","जगह","वापस","सामने","आसपास"
  ] },
  { id:"description", label:"Useful descriptions", words:[
    "सही","ग़लत","खराब","बढ़िया","बेहतर","अलग","समान","खाली","खुली","छोटा सा",
    "गर्म पानी","ठंडा पानी","खुश होना","दुखी होना","डर लगना","परेशान होना","समझदार",
    "व्यस्त","कमज़ोर","मज़बूत","स्वादिष्ट"
  ] },
  { id:"connections", label:"Joining ideas & useful expressions", words:[
    "के साथ","के लिए","के बारे","लेकिन","इसलिए","वजह से","जब","तो","तक","हर",
    "सब","कुछ","बहुत","ज़्यादा","कुछ नहीं","कोई नहीं","अगला","पहला","दूसरा",
    "केवल","सिर्फ़","सिर्फ","एक साथ","मिलकर","अकेले","सच में","आसानी से","जानकारी"
  ] }
];

export function learningKey(word){
  return String(typeof word === "string" ? word : word?.hindi || "")
    .normalize("NFC").replace(/़/g,"").replace(/[?।.!]/g,"").replace(/\s+/g," ").trim();
}

const CORE_BY_KEY = new Map(CORE_THEMES.flatMap((theme)=>theme.words.map((hindi)=>[learningKey(hindi),theme])));

export function coreTheme(word){ return CORE_BY_KEY.get(learningKey(word)) || null; }

export function importantWords(wordsByPhase, phaseKeys=Object.keys(wordsByPhase)){
  const entries = new Map();
  phaseKeys.forEach((phaseKey)=>{
    (wordsByPhase[phaseKey] || []).forEach((word)=>{
      const theme = coreTheme(word);
      const key = learningKey(word);
      if(!theme || !word.english?.length) return;
      if(!entries.has(key)) entries.set(key,{...word,phaseKey,theme:theme.id,themeLabel:theme.label});
    });
  });
  return [...entries.values()].sort((a,b)=>
    CORE_THEMES.findIndex(theme=>theme.id===a.theme)-CORE_THEMES.findIndex(theme=>theme.id===b.theme)
  );
}
