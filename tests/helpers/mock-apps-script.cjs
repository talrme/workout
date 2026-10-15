const fs=require('fs'),vm=require('vm');
function makeBackend(initial={}) {
 const tables={};const backups=[];const properties={};let copiesFail=false;
 function sheet(name, rows=[]) {
  const s={name,rows:structuredClone(rows),getLastRow(){return this.rows.length},getLastColumn(){return Math.max(0,...this.rows.map(r=>r.length))},appendRow(row){this.rows.push([...row]);return this},
   getRange(row,col,height=1,width=1){return {getValues:()=>Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>s.rows[row-1+y]?.[col-1+x]??'')),setValues:values=>{for(let y=0;y<height;y++){s.rows[row-1+y]??=[];for(let x=0;x<width;x++)s.rows[row-1+y][col-1+x]=values[y][x]}},setValue:value=>{s.rows[row-1]??=[];s.rows[row-1][col-1]=value}}},
   getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()))}};return s;
 }
 Object.entries(initial).forEach(([name,rows])=>tables[name]=sheet(name,rows));
 const ss={getId:()=> 'test-spreadsheet',getSheetByName:name=>tables[name]||null,insertSheet:name=>tables[name]=sheet(name),copy:name=>{if(copiesFail)throw Error('Backup failed');const copy={name,tables:structuredClone(Object.fromEntries(Object.entries(tables).map(([n,s])=>[n,s.rows])))};backups.push(copy);return {getUrl:()=>`https://example.invalid/backup/${backups.length}`}}};
 const context={SpreadsheetApp:{getActive:()=>ss,flush:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties[k]||null,setProperty:(k,v)=>{properties[k]=v}})},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},ContentService:{MimeType:{JAVASCRIPT:'js'},createTextOutput:text=>({text,setMimeType(){return this}})},console:{log:()=>{}}};vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').resolve(__dirname, '../../backend.sample.gs'),'utf8'),context);
 return {tables,backups,properties,context,setCopyFailure:flag=>copiesFail=flag,setup:()=>context.setupWorkoutUsers(),call:(action='snapshot',userId,payload={})=>{const p={action,payload:JSON.stringify(payload),callback:'testCallback'};if(userId)p.userId=userId;const text=context.doGet({parameter:p}).text;if(!text.startsWith('testCallback('))throw Error('Bad JSONP callback: '+text.slice(0,100));return JSON.parse(text.slice('testCallback('.length,-2));}};
}
const legacy={Machines:[['id','name','targetWeight','setupNotes','updatedAt'],['leg-press','Leg Press',180,'Seat 4','2026-10-01'],['plank','Plank','30s','Breathe','2026-10-01']],Logs:[['id','date','createdAt','profileName','machineId','machineName','weight','reps','effort','rir','note'],['old-1','2026-10-01','2026-10-01T12:00:00Z','Tal','leg-press','Leg Press',175,'','','','Keep this'],['old-delete','2026-10-01','2026-10-01T12:01:00Z','Other name','plank','Plank','','','','','__WORKOUT_DELETE__']]};
module.exports={makeBackend,legacy};
