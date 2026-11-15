import test from 'node:test';
import assert from 'node:assert/strict';
import {surveyDates,compareSurveyDates} from '../survey-dates.mjs';

test('observation ranges use UTC MJD bounds, separately from publication dates',()=>{
  const dss=surveyDates('dss2',{t_min:'42413',t_max:'51179',hips_release_date:'2019-05-07T10:55Z'});
  assert.equal(dss.start,'1975-01-01');assert.equal(dss.end,'1999-01-01');
  assert.equal(dss.label.includes('2019'),false);
  const spherex=surveyDates('spherex',{t_min:'60789.75076',t_max:'61174.49276'});
  assert.equal(spherex.start,'2025-04-24');assert.equal(spherex.end,'2026-05-14');
});

test('Gaia DR3 has a documented observation range when its map omits MJD bounds',()=>{
  const dates=surveyDates('gaia',{creator_did:'ivo://ESAVO/P/GAIA/DR3-RGB',hips_release_date:'2025-05-29T14:17Z'});
  assert.equal(dates.start,'2014-07-25');assert.equal(dates.end,'2017-05-28');
  assert.ok(dates.source.includes('GDR3'));
  assert.equal(surveyDates('gaia',{creator_did:'ivo://future/DR4'}).type,'unknown');
  const actual=surveyDates('gaia',{creator_did:'ivo://ESAVO/P/GAIA/DR3-RGB',t_min:'60000',t_max:'60001'});
  assert.equal(actual.start,'2023-02-25');
});

test('WISE observation dates come from the selected map, rather than later processing or mission lifetime',()=>{
  const dates=surveyDates('wise',{t_min:'55378',t_max:'55414',hips_release_date:'2019-05-20T08:30Z'});
  assert.equal(dates.start,'2010-07-01');assert.equal(dates.end,'2010-08-06');
  assert.equal(dates.label.includes('2019'),false);
  assert.equal(dates.label.includes('2024'),false);
});

test('missing, reversed or invalid observation bounds are not replaced by release dates',()=>{
  for(const properties of [{},{t_min:'',t_max:'51179'},{t_min:'bad',t_max:'51179'},
    {t_min:'51179',t_max:'42413'},{hips_release_date:'2026-11-15'}]){
    assert.equal(surveyDates('spherex',properties).type,'unknown');
  }
});

test('older archives stay explicitly historical and overlapping mosaics are not claimed to be synchronized',()=>{
  const reference={start:'2025-04-24',end:'2026-05-14'};
  assert.match(compareSurveyDates(reference,{start:'2014-07-25',end:'2017-05-28'}),/Historical comparison.*no matching SPHEREx epoch/);
  assert.match(compareSurveyDates(reference,{start:'2027-01-01',end:'2027-05-01'}),/newer than/);
  assert.match(compareSurveyDates(reference,{start:'2026-01-01',end:'2026-05-01'}),/overlap.*not matched/);
  assert.match(compareSurveyDates(reference,{}),/cannot be verified/);
});

test('dated SPHEREx frames show their exact observation timestamp instead of a mosaic publication date',()=>{
  const dates=surveyDates('spherex',{hips_release_date:'2026-11-01'},
    {observedStart:'2026-08-25T07:03:31Z'});
  assert.equal(dates.label,'Observed 2026-08-25 07:03:31 UTC');
  assert.equal(dates.type,'exposure');
});
