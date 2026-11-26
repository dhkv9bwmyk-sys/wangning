(function(root){
  'use strict';

  const authorizedRosters=Object.freeze({C02:'examples/seats-c02.json'});
  const campusCodes=/(?<![A-Z0-9])(?:校区(\d{1,2})|C(\d{1,2})|(\d{1,2})校区)(?![A-Z0-9])/g;
  const unnamedCampus=/^(?:(?:请|帮我|我想|我要|能|可以)*(?:查(?:询|看)?(?:一下)?|看(?:看|一下)?))?校区(?:里?的)?(?:班级|报名|剩余|可报名)?(?:名额|余位|空位)[吗么]?[?？。！!]*$/;
  const quarterNames={暑假:'暑假',暑期:'暑假',秋季:'秋季',秋期:'秋季',寒假:'寒假',寒期:'寒假',春季:'春季',春期:'春季'};
  const normalize=text=>text.normalize('NFKC').replace(/\s+/g,'').toUpperCase();

  function checkAccess(question,priorQuestion=''){
    const text=normalize(question);
    const campusIds=new Set([...text.matchAll(campusCodes)].map(match=>'C'+(match[1]||match[2]||match[3]).padStart(2,'0')));
    const remaining=text.replace(campusCodes,'').replace(/(?:当前|本|哪个|哪些|一个|某个|这个|该)校区/g,'');
    const otherSchool=/外校|跨校|其他(?:学校|机构)|别的学校|(?:学校|机构)[B-Z]/.test(text);
    const unresolvedCampus=remaining.includes('校区')&&!unnamedCampus.test(text);
    if(otherSchool||unresolvedCampus)return {state:'denied'};
    if(/本校区|当前校区/.test(text))campusIds.add('C02');
    if(!campusIds.size)return {state:'missing'};
    if(campusIds.size!==1)return {state:'denied'};
    const [campusId]=campusIds;
    if(!Object.hasOwn(authorizedRosters,campusId))return {state:'denied'};
    const filters=normalize(priorQuestion+question);
    return {
      state:'allowed',campusId,campusName:'校区'+campusId.slice(1),
      quarters:[...filters.matchAll(/暑假|暑期|秋季|秋期|寒假|寒期|春季|春期/g)].map(match=>quarterNames[match[0]]),
      fiscalYear:filters.match(/FY\d+|\d{4}(?:财年|年)/)?.[0],
      className:filters.match(/科目[A-Z]\d{2}班/)?.[0]
    };
  }

  function isCampusReply(question){
    const text=normalize(question);
    return /^(?:(?:帮我)?(?:查(?:询)?|看|用|就))?(?:C\d{1,2}|校区\d{1,2}|(?:[\p{L}\d]{1,16})校区)[?？。！!]*$/u.test(text);
  }

  async function readRoster(access){
    const {state,campusId,campusName,quarters,fiscalYear,className}=access;
    if(state!=='allowed'||!Object.hasOwn(authorizedRosters,campusId))throw Error('当前账号无权查询该校区的班级名额。');
    let roster=root.OFFLINE_SEAT_ROSTERS?.[campusId];
    if(!roster){
      const response=await root.fetch(authorizedRosters[campusId],{cache:'no-cache'});
      if(!response.ok)throw Error('报名台账暂时读取失败。');
      roster=await response.json();
    }
    if(roster?.campusId!==campusId||!roster.fiscalYear||!roster.quarter||!Array.isArray(roster.classes)){
      throw Error('报名台账校区或字段异常。');
    }
    const entries=roster.classes.filter(row=>!className||row.name===className);
    const inTerm=(!quarters.length||quarters.every(quarter=>quarter===roster.quarter))&&(!fiscalYear||fiscalYear===roster.fiscalYear);
    const rows=[];
    const totals={capacity:0,enrolled:0,available:0};
    if(inTerm){
      for(const {name,capacity,enrolled} of entries){
        if(!name||!Number.isInteger(capacity)||!Number.isInteger(enrolled)||capacity<0||enrolled<0)throw Error('班级名额字段异常。');
        const available=Math.max(0,capacity-enrolled);
        rows.push({name,capacity,enrolled,available});
        totals.capacity+=capacity;
        totals.enrolled+=enrolled;
        totals.available+=available;
      }
    }
    return {campusName,term:roster.fiscalYear+' · '+roster.quarter,rows,totals,
      sourceFile:roster.sourceFile,sourceSheet:roster.sourceSheet};
  }

  root.DeskSeatLookup={checkAccess,isCampusReply,readRoster};
})(window);
