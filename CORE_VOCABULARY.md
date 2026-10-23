# Everyday essentials

The first selection contains 218 distinct existing Hindi words and expressions, grouped by practical purpose. The app displays and searches this selection under Daily practice → View important words.

This is an editorial selection for everyday communication, not a statistical frequency ranking. Its themes are people and family; questions and conversation; everyday actions; food and drink; needs, health and help; numbers and time; places and transport; useful descriptions; and connecting ideas.

The thematic approach is informed by Michigan State University's [Basic Hindi: Greetings and Introductions](https://openbooks.lib.msu.edu/basichindi/chapter/greetings/). Its contents also organise beginner communication around family, describing places, likes and needs, requests, directions and everyday actions. The selected entries and their existing English answers come from this app's lessons. No new words or rewritten teacher answers have been added for this selection.

`core-vocabulary.js` owns the selection. Spelling variants with or without nukta and question punctuation are matched consistently. Repeated lesson entries are shown once in the essential-word catalogue.

Daily practice gives due reviews priority, then unseen essentials before other new words. A word is steady after unambiguous correct answers on three distinct days since its latest failure, including at least one typed or recalled answer. Recognised Phase 1 words advance from multiple choice to typing on later days.

All missed or difficult words from earlier days get a review slot, including words outside the essential selection. They remain due until correct on two distinct days after the most recent failure. Fixing a word on the same day does not cancel tomorrow's review. The round normally contains 20 words; more review words increase the relevant phase's quota so no due error is silently left out. Words remain ordered by phase and lesson.

Guest attempts are stored in this browser and excluded from cloud payloads. Signed-in attempts use the existing account sync. Answers are saved immediately, even before a round is finished. Today's answers affect tomorrow's selection, keeping today's round stable.

Run `node --test daily-practice.test.mjs daily-learning.test.mjs` after changes to selection or review logic.

## Adaptive spacing and the learning studio

Successful recall on separate days increases the review interval through 1, 3, 7, 14, 30 and 60 days. Recognition alone stays at one day. Same-day repeats do not advance the interval. A missed or difficult answer resets the interval and requires two later successful days before spacing resumes. No resting word is added just to fill the daily quota: short days and fully caught-up days are valid. Due reviews and errors come before unseen essentials. All unresolved errors still return the next day, even if that makes a round longer than 20.

The coach, daily practice, free-practice prioritisation and practice mastery labels share `learningHistory`. Free practice puts difficult, due and unseen words before resting words; resting words remain available when explicitly requesting a large round from selected lessons. Coaching includes today's answers for immediate feedback; the daily queue uses previous days to keep today's selection stable. Both guests and logged-in users can use the coach. `learning-dashboard.js` derives unique-word progress, focus words, essentials and a real seven-day activity record from the existing attempt ledger; it creates no synthetic activity. Existing word lists, edits, scores and attempts are retained. This is a transparent rule-based schedule, not an online AI model or a validated prediction of memory. No API key or paid service is required.

The home page opens the coach. Existing phase, lesson and daily links still work; `?view=coach` is a direct coach link. `studio.css` provides the responsive visual layer and reduced-motion support. The previous challenge remains available as an optional tool for logged-in users.

Verification: `node --test daily-practice.test.mjs daily-learning.test.mjs learning-dashboard.test.mjs`.
