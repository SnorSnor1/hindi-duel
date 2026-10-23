# Private progress sync — activation and verification

The client implementation is ready, but **cloud sync is not active** while `firebase-config.js` is `null`. A Firebase project must be connected under the user's control. Do not report cross-device sync as working until the deployed service and two independent browser sessions have passed the checks below.

## Infrastructure

Use a dedicated Hindi Duel Firebase project. Keep it on the free Spark plan; do not add billing, analytics, public database access or anonymous authentication. If creating the account/project requires accepting terms, the user must do that step.

1. Create/register the web app in the dedicated project.
2. Create a Realtime Database, preferably in an available EU location. Keep the default locked rules until the rules in this repository are deployed.
3. Enable **Google** in Firebase Authentication. Add `snorsnor1.github.io` as an authorized domain. Do not authorize localhost in production.
4. Deploy `firebase-database.rules.json` to this dedicated database. `firebase.json` references it. Do not overwrite rules for any unrelated project.
5. Copy only the public web configuration to `firebase-config.js` as `window.HINDI_DUEL_FIREBASE_CONFIG = { apiKey, authDomain, databaseURL, projectId, appId }`. Firebase web configuration identifies the project; it is not an administrative credential. Never include service-account keys, OAuth secrets or learner data in the repository.
6. Publish the config with a new cache version in `index.html`.

The dedicated paths are `hindiDuel/users/<authenticated Firebase uid>/profiles/<maaike or vincent>`. Rules require that the UID matches and the user authenticated with Google. There is no read or write permission at the shared root. The legacy local profile password grants no cloud access.

## User flow

Open **Sync devices**, choose the learner profile, and continue with Google on the device with existing progress. Guest history is included only when the user selects that option. After the server confirms **Synced across devices**, connect the same Google account and learner profile on the other device.

Only the selected learner's attempts, scores, difficult words, word edits, reminder time and daily-practice checkpoint are included. Other learners' answers, passwords and identity tokens are excluded from exported profile data. A local learner profile already bound to one Google UID cannot be silently uploaded to another account.

Answers are still persisted locally first. Server writes use Realtime Database transactions that union attempt IDs and preserve the newest approval/hard-word changes. A stale device cannot reset a run to an earlier position or resurrect a completed run. Score resets have timestamps. Failed sync stays visibly pending/error; the client does not claim confirmation before a server transaction commits.

The daily checkpoint records the next unanswered word. Resuming after the final answer displays the completed round. Starting a new daily round supersedes the previous checkpoint. This does not resume the separate timed Challenge.

## Verification before declaring activation complete

- Run `node --test *.test.mjs`.
- Validate the rules with the Firebase emulator or a dedicated test project: unauthenticated access denied, another UID denied, own Google UID permitted, unsupported profile version denied.
- In isolated sessions A and B, authenticate as the same learner. Answer on A; confirm B receives the answer and revised coach progress. Reverse the direction.
- Answer on both sessions before a refresh. Both attempt IDs must remain after transaction retry.
- Disconnect A's network, answer, reload, reconnect; confirm B receives the queued progress and the UI reports success only after acknowledgment.
- Start a daily round on A, answer one word, and resume on B at word two. Finish it; stale A must not restore an unfinished checkpoint.
- Confirm **Count as correct**, **Felt hard**, the daily result and score resets survive an older device reconnecting.
- A different Google account must not read the first account's profile or import its locally bound data.
- Capture the deployed Sync screen as proof. Until these real-service checks pass, describe the feature as prepared, not activated.

## Reproducible local rules test

Requires Node 20+ and Java 21+. Install the test SDK outside the repository, then use the explicit demo project:

```sh
npm install --prefix /tmp/hindi-sync-tests --no-audit --no-fund @firebase/rules-unit-testing@3.0.4 firebase@10.14.0
HINDI_RULES_TEST_PACKAGE=/tmp/hindi-sync-tests/package.json npx -y firebase-tools@latest emulators:exec --only database --project demo-hindi-duel --config firebase.emulator.json "node tests/firebase-rules.emulator.mjs"
```

The script refuses any project other than `demo-hindi-duel` and any database host other than `127.0.0.1:9400`. It uses synthetic learning records. On 23 October 2026, the test passed against Database Emulator 4.11.2 with Firebase SDK 10.14.0: own Google clients could read/write and preserve concurrent answers; guests, anonymous auth, other UIDs, parent listing, unknown profiles and unsupported versions were denied. These are emulator results, not proof of an activated production service.

Official references: [Firebase Google authentication](https://firebase.google.com/docs/auth/web/google-signin), [database transactions](https://firebase.google.com/docs/database/web/read-and-write#save_data_as_transactions), [security rules](https://firebase.google.com/docs/database/security), [public Firebase configuration/API keys](https://firebase.google.com/docs/projects/api-keys).
