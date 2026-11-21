import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.qa-reading');
mkdirSync(output, {recursive: true});
const browser = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const prelude = `<script>
window.localStorage.removeItem('sotv_round');
window.__calls=[];window.__question=0;window.SOTV_MATH=function(){};
function trackFeedback(token) { window.__feedbackToken = token; }
window.SOTVNative={
  deviceInfo:function(){return '{"platform":"android-tv"}'},
  readInLanguage:function(text){window.__calls.push(text)},
  readQuizPass:function(text, language, token){window.__calls.push(text);window.__readToken=token},
  readFeedbackPhrase:function(text, language, token){trackFeedback(token)},
  playFeedbackClip:function(clip, token){trackFeedback(token)},
  stopReading:function(){},
  exitToLauncher:function(){window.__exited=true}
};
function mockRound(number) {
  return {nonce:'mock-'+number,mode:'practice',answered:number-1,target:3,
    question:{id:'q'+number,q:number===1?'小明有三个苹果，妈妈又给了他两个苹果，现在一共有几个苹果？':'第二道题：七加八等于多少？',type:'single',a:['三个','五个','六个','十五个'],k:1}};
}
window.XMLHttpRequest=function(){};
XMLHttpRequest.prototype.open=function(method,path){this.path=path};
XMLHttpRequest.prototype.setRequestHeader=function(){};
XMLHttpRequest.prototype.send=function(body){
  var self=this, payload=JSON.parse(body || '{}');
  setTimeout(function(){
    var data={}, learning={reason:window.__question?'timeup':'',canExit:!window.__question,remainingSeconds:120};
    if(self.path==='/api/state')data={config:{supervisionEnabled:true,playMode:'count',fontScale:100,roundsPerDay:3},learning:learning,speech:{autoRead:false}};
    if(self.path==='/api/quiz/start'){
      if(payload.focus==='quiz')window.__question=1;
      data=window.__question?mockRound(window.__question):{watching:true,status:learning};
    }
    if(self.path==='/api/quiz/answer')data={correct:payload.selections[0]===1,correctIndices:[1],next:mockRound(2)};
    if(self.path==='/api/quiz/continue'){window.__question=2;data={status:learning};}
    self.status=200;self.readyState=4;self.responseText=JSON.stringify(data);self.onreadystatechange();
  },10);
};
</script>`;
const checks = `<script>
function assert(ok,msg){if(!ok)throw Error(msg)}
function checkAfter(delay, check) {
  setTimeout(function(){try{check()}catch(e){document.documentElement.setAttribute('data-reading-result','FAIL: '+e.message)}},delay);
}
function checkEntry() {
  var focused=function(){return document.querySelector('#lockActions .focused')};
  assert(focused() && focused().textContent==='继续练题','entry must initially focus practice');
  TV.move('left');
  var home=focused();
  assert(home && home.textContent==='返回桌面','cannot navigate to the exit button');
  window.SOTV_RESUME();
  checkAfter(100,function(){
    assert(focused()===home,'resuming the entry screen reset the remote focus');
    TV.move('right');
    window.SOTV_RESUME();
    TV.select();
    checkAfter(400,checkFirst);
  });
}
function checkFirst(){
var read=document.getElementById('readAloudBtn'),q=document.getElementById('qText');
assert(!window.__exited,'quick selection exited to the launcher');
assert(document.querySelector('.focused')===read,'first question does not focus reading icon');
assert(read.querySelector('svg'),'missing speaker icon');
var r=read.getBoundingClientRect(),t=q.getBoundingClientRect();
assert(r.width>=60&&r.height>=60,'reading target is too small');
assert(r.right<t.left,'reading icon must be to the left of question');
TV.select();assert(window.__calls.length===1&&window.__calls[0].indexOf('小明')===0,'OK did not read first question');
assert(!document.querySelector('#qReadingStatus'),'reading status is still present');
window.SOTV_QUIZ_READ_DONE(window.__readToken,true);
assert(read.getAttribute('aria-label')==='停止朗读','the speaker must remain stoppable between passes');
TV.select();
assert(read.getAttribute('aria-label')==='朗读题目','OK did not stop question reading');
TV.move('down');assert(document.querySelector('.focused')!==read,'cannot navigate from icon to answers');
document.querySelector('[data-opt="0"]').click();
checkAfter(60,function(){
  checkFeedback(false);
  TV.select();
  checkAfter(400,checkNext);
});
}
function checkFeedback(correct) {
  var feedback=document.getElementById('qFeedback'), next=document.getElementById('fbNext');
  assert(feedback.classList.contains(correct?'is-right':'is-wrong'),'wrong feedback state');
  assert(window.__feedbackToken && next.disabled,'feedback audio did not start');
  assert(feedback.querySelectorAll('button').length===1 && next.textContent==='继续','feedback shows playback controls');
  window.SOTV_QUIZ_READ_DONE(window.__feedbackToken,true);
  window.__feedbackToken=null;
  assert(next.textContent==='继续' && !next.disabled,'continuation did not become available');
}
function checkNext(){
assert(document.querySelector('.focused').id==='readAloudBtn','new question must refocus icon');
TV.select();assert(window.__calls.length===2&&window.__calls[1].indexOf('第二道题')===0,'OK did not read new question');
document.querySelector('[data-opt="1"]').click();
checkAfter(60,function(){
  checkFeedback(true);
  document.documentElement.setAttribute('data-reading-result','PASS');
});
}
window.addEventListener('load',function(){checkAfter(100,checkEntry)});
</script>`;
const source = readFileSync(resolve(root, 'app/web/index.html'), 'utf8');
const html = source.replace('<head>', `<head><base href="${pathToFileURL(resolve(root, 'app/web')).href}/">${prelude}`)
    .replace('</body>', `${checks}</body>`);
const file = resolve(output, 'reading.html');
writeFileSync(file, html);
for (const [width, height] of [[1280,720],[1920,1080]]) {
    const result = execFileSync(browser, ['--headless=new', '--no-first-run', '--allow-file-access-from-files',
        '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width},${height}`,
        `--user-data-dir=${resolve(output, 'profile-'+width)}`, '--virtual-time-budget=2500', '--dump-dom',
        `--screenshot=${resolve(output, 'reading-'+width+'.png')}`, pathToFileURL(file).href],
        {encoding:'utf8', maxBuffer:10*1024*1024, stdio:['ignore','pipe','ignore']});
    const match = result.match(/data-reading-result="([^"]+)"/);
    if (match?.[1] !== 'PASS') throw Error(`${width}x${height}: ${match?.[1] || 'test did not finish'}`);
    console.log(`PASS ${width}x${height}: entry and resume focus, remote reading and navigation, correct and incorrect feedback`);
}
