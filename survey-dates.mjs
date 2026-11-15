const DAY=86400000;
const GAIA_DR3_DATES={
  start:'2014-07-25',end:'2017-05-28',
  source:'https://gea.esac.esa.int/archive/documentation/GDR3/index.html'
};

function mjdDate(value) {
  if(value===null || value===undefined || String(value).trim()==='')return null;
  const number=Number(value),date=new Date((number-40587)*DAY);
  return Number.isFinite(number) && Number.isFinite(date.getTime())?date.toISOString().slice(0,10):null;
}

export function surveyDates(id,properties={},exposure=null) {
  if(exposure){
    const date=new Date(exposure.observedStart);
    if(Number.isFinite(date.getTime()))return {
      start:date.toISOString().slice(0,10),end:date.toISOString().slice(0,10),
      label:`Observed ${date.toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC')}`,
      type:'exposure'
    };
  }
  let start=mjdDate(properties.t_min),end=mjdDate(properties.t_max),source=null;
  if((!start || !end) && id==='gaia' && properties.creator_did==='ivo://ESAVO/P/GAIA/DR3-RGB'){
    ({start,end,source}=GAIA_DR3_DATES);
  }
  if(!start || !end || start>end)return {start:null,end:null,label:'Observation dates not provided',type:'unknown'};
  return {start,end,source,type:'survey',label:`Survey observations ${start===end?start:`${start} – ${end}`} (UTC)`};
}

export function compareSurveyDates(reference,alternative) {
  if(!reference?.start || !reference?.end || !alternative?.start || !alternative?.end){
    return 'Matching observation dates cannot be verified.';
  }
  if(alternative.end<reference.start){
    return `Historical comparison · no matching SPHEREx epoch. This survey ends ${alternative.end}.`;
  }
  if(alternative.start>reference.end){
    return 'This survey is newer than the SPHEREx observation range; the epochs do not match.';
  }
  return 'Observation ranges overlap; these combined maps are not matched to one observation date.';
}
