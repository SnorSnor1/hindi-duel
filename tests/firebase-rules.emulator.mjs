// Run only with a demo project and a loopback Realtime Database emulator.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {makeProgressProfile,mergeProgressProfiles,privateProgressPath} from '../progress-sync.js';

assert.equal(process.env.GCLOUD_PROJECT,'demo-hindi-duel');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,'127.0.0.1:9400');
const require=createRequire(process.env.HINDI_RULES_TEST_PACKAGE || import.meta.url);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const testEnv=await initializeTestEnvironment({
  projectId:'demo-hindi-duel',
  database:{host:'127.0.0.1',port:9400,rules:readFileSync(new URL('../firebase-database.rules.json',import.meta.url),'utf8')}
});
const google={firebase:{sign_in_provider:'google.com',identities:{}}};
const phone=testEnv.authenticatedContext('learner-one',google).database();
const laptop=testEnv.authenticatedContext('learner-one',google).database();
const other=testEnv.authenticatedContext('learner-two',google).database();
const guest=testEnv.unauthenticatedContext().database();
const anonymous=testEnv.authenticatedContext('learner-one',{firebase:{sign_in_provider:'anonymous'}}).database();
const path=privateProgressPath('learner-one','maaike');
const attempt=id=>({id,date:'2026-10-23',createdAt:'2026-10-23T10:00:00Z',hindi:'पानी',english:['water'],category:'Lesson / 1.a',correct:true,mode:'type'});
const profile=id=>makeProgressProfile({attempts:{maaike:{phase1:[attempt(id)]}}},'maaike');
try{
  await testEnv.clearDatabase();
  await assertSucceeds(phone.ref(path).set(profile('phone')));
  const first=await assertSucceeds(laptop.ref(path).get());
  assert.equal(first.val().attempts.phase1[0].id,'phone');
  await assertFails(guest.ref(path).get());
  await assertFails(guest.ref(path).set(profile('guest')));
  await assertFails(other.ref(path).get());
  await assertFails(other.ref(path).set(profile('other')));
  await assertFails(anonymous.ref(path).get());
  await assertFails(anonymous.ref(path).set(profile('anonymous')));
  await assertFails(phone.ref('hindiDuel/users').get());
  await assertFails(phone.ref('hindiDuel/users/learner-one/profiles/guest').set(profile('invalid-profile')));
  await assertFails(phone.ref(path).set({version:99}));
  await assertSucceeds(phone.ref(privateProgressPath('learner-one','vincent')).set(profile('separate-profile')));
  await assertSucceeds(other.ref(privateProgressPath('learner-two','maaike')).set(profile('separate-account')));
  await Promise.all([
    assertSucceeds(phone.ref(path).transaction(remote=>mergeProgressProfiles(profile('phone-next'),remote || {}),undefined,false)),
    assertSucceeds(laptop.ref(path).transaction(remote=>mergeProgressProfiles(profile('laptop'),remote || {}),undefined,false))
  ]);
  const final=(await laptop.ref(path).get()).val();
  assert.deepEqual(final.attempts.phase1.map(item=>item.id).sort(),['laptop','phone','phone-next']);
  console.log('PASS: real Firebase rules block guests, anonymous auth, other accounts, parent listing, unknown profiles and unsupported versions. Independent clients preserve concurrent answers.');
}finally{await testEnv.cleanup();}
