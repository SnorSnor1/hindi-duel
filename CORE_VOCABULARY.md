# Everyday essentials

The first selection contains 218 distinct existing Hindi words and expressions, grouped by practical purpose. The app displays and searches this selection under Daily practice → Browse important words.

This is an editorial selection for everyday communication, not a statistical frequency ranking. Its themes are people and family; questions and conversation; everyday actions; food and drink; needs, health and help; numbers and time; places and transport; useful descriptions; and connecting ideas.

The thematic approach is informed by Michigan State University's [Basic Hindi: Greetings and Introductions](https://openbooks.lib.msu.edu/basichindi/chapter/greetings/). Its contents also organise beginner communication around family, describing places, likes and needs, requests, directions and everyday actions. The selected entries and their existing English answers come from this app's lessons. No new words or rewritten teacher answers have been added for this selection.

`core-vocabulary.js` owns the selection. Spelling variants with or without nukta and question punctuation are matched consistently. Repeated lesson entries are shown once in the essential-word catalogue.

Daily practice gives due reviews priority, then unseen essentials before other new words. A word is steady after unambiguous correct answers on three distinct days since its latest failure, including at least one typed or recalled answer. Recognised Phase 1 words advance from multiple choice to typing on later days.

Missed or difficult words from earlier days get priority in the review queue, including words outside the essential selection. They remain due until correct on two distinct days after the most recent failure. Fixing a word on the same day does not cancel tomorrow's review. The interface defaults to a short 10-word round, with 20 as an option. Rounds never exceed 20 words. Larger backlogs remain saved and rotate across later days; the least recently practised words get priority. Words remain ordered by phase and lesson.

Guest attempts are stored in this browser. Private authenticated sync can import them into a selected learner profile only when explicitly selected during connection. Signed-in attempts use the existing account sync only when Firebase is configured. The current checked-in configuration is disabled, so answers remain local to this browser; the UI states that explicitly. Answers are saved immediately, even before a round is finished. Today's answers affect tomorrow's selection, keeping today's round stable.

Run `node --test daily-practice.test.mjs daily-learning.test.mjs` after changes to selection or review logic.

## Adaptive spacing and the learning studio

Successful recall on separate days increases the review interval through 1, 3, 7, 14, 30 and 60 days. Recognition alone stays at one day. Same-day repeats do not advance the interval. A missed or difficult answer resets the interval and requires two later successful days before spacing resumes. No resting word is added just to fill the daily quota: short days and fully caught-up days are valid. The daily limit is a learner preference, included in private sync when configured. Due reviews and errors come before unseen essentials. Unresolved errors enter the next-day review queue. When the queue is larger than a round, reviews are spread across days without deleting their history.

The coach, daily practice, free-practice prioritisation and practice mastery labels share `learningHistory`. Free practice puts difficult, due and unseen words before resting words; resting words remain available when explicitly requesting a large round from selected lessons. Coaching includes today's answers for immediate feedback; the daily queue uses previous days to keep today's selection stable. Both guests and logged-in users can use the coach. `learning-dashboard.js` derives unique-word progress, focus words, essentials and a real seven-day activity record from the existing attempt ledger; it creates no synthetic activity. Existing word lists, edits, scores and attempts are retained. This is a transparent rule-based schedule, not an online AI model or a validated prediction of memory. No API key or paid service is required for coaching or scheduling.

The home page opens the single Daily practice routine; the old coach link redirects there. Existing phase, lesson and daily links still work; `?view=coach` is a direct coach link. `studio.css` provides the responsive visual layer and reduced-motion support. The previous challenge is called Optional timed quiz and is available under More for logged-in users. Lesson word-bank totals are explicitly separated from the capped round size.

Verification: `node --test daily-practice.test.mjs daily-learning.test.mjs learning-dashboard.test.mjs`.

## Phone and laptop progress

`progress-sync.js` owns private learner snapshots and merge rules; `cloud-progress.js` owns Google authentication, connection state and transactional writes. `SYNC_SETUP.md` documents activation, privacy and required verification. No cloud service is active while the Firebase configuration remains null. Daily rounds now save a local checkpoint immediately and can resume at the next unanswered word, even before cloud setup is finished.
