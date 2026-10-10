// Records a packaged tutorial: node rec.js student|partner [timing.json]
const { chromium } = require('playwright'); const fs = require('fs');
const OUT = __dirname + '/vid/';
const which = process.argv[2] || 'student';
const timing = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STUDENT = {
  role: 'student',
  card: { eye: 'Orbuni guide · for students', h: 'Your Orbuni portal, <em>in two minutes</em>', p: 'Where everything is, and the few things you need to do — from your first document to your first night in Istanbul.',
          chap: ['Your dashboard', 'Documents', 'Programmes', 'Offers', 'Housing', 'Getting help'], r: 'Voice: Orbuni' },
  outro: { eye: 'You are all set', h: 'Welcome to <em>Orbuni</em>', p: 'Questions any time: tap the Orbuni button in the corner, or WhatsApp us on +1 443 448 1577.', r: 'Applying is free' },
  chapters: [
    { t: 'Your dashboard', s: 'The bar shows how complete your file is. “Next thing to do” always shows the one step that matters most.', dur: 10000,
      run: async (pg) => { await go(pg, "sGo('track')"); await sleep(900); await act(pg, "TUT.move('File complete');TUT.ring('File complete',10)"); await sleep(3200); await act(pg, "TUT.move('Applications');TUT.ring('Applications',10)"); await sleep(2600); await act(pg, "TUT.move('Offers');TUT.ring('Offers',10)"); } },
    { t: 'Upload your documents', s: 'Passport, transcript and school certificate — a clear phone photo is fine. A green tick means your counsellor has verified it.', dur: 13000,
      run: async (pg) => { await go(pg, "sGo('docs')"); await sleep(2000); await act(pg, "TUT.move('Add or replace');TUT.ring('Add or replace',6)"); await sleep(3000); await act(pg, "TUT.move('Checked and accepted');TUT.ring('Checked and accepted',14)"); await sleep(3400); await act(pg, "TUT.move('Passport photo');TUT.ring('Passport photo',60)"); } },
    { t: 'Choose up to three programmes', s: 'Search by course, language or budget and pick up to three. Orbuni applies for you — applying is free.', dur: 9000,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "sGo('apps')"); await sleep(1100); await act(pg, "TUT.move('Choice 1');TUT.ring('Choice 1',4)"); await sleep(3000); await act(pg, "TUT.move('Choice 2');TUT.ring('Choice 2',4)"); } },
    { t: 'Follow it, and see your offers', s: 'Every application shows where it stands. Offers appear in My offers — we also tell you on WhatsApp and by email.', dur: 10500,
      run: async (pg) => { await act(pg, "TUT.move('Offer received');TUT.ring('Offer received',8)"); await sleep(3600); await act(pg, "TUT.noring();TUT.move('My offers')"); await sleep(1000); await act(pg, "TUT.click()"); await go(pg, "sGo('offers')"); await sleep(1200); await act(pg, "TUT.move('Your offer has arrived');TUT.ring('Your offer has arrived',30)"); } },
    { t: 'Housing and airport pickup', s: 'Once you accept, choose a residence near your university and book an airport pickup if you like.', dur: 8000,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "sGo('housing')"); await sleep(1400); await act(pg, "TUT.move('Mimosa Female');TUT.ring(document.querySelectorAll('#s-live .panel, #s-live [class*=card]')[1]||'Mimosa Female',4)"); await sleep(2600); await act(pg, "TUT.move('See this residence')"); } },
    { t: 'Help is one tap away', s: 'Tap the Orbuni button in the corner. Your counsellor is one message away — or WhatsApp us.', dur: 8500,
      run: async (pg) => { await act(pg, "TUT.noring();TUT.move('#ol-btn')"); await sleep(1000); await act(pg, "TUT.click();olToggle(true)"); await sleep(2600); await act(pg, "TUT.move('My counsellor')"); await sleep(1100); await act(pg, "TUT.click();olToggle(false)"); await go(pg, "sGo('help')"); await sleep(1500); await act(pg, "TUT.move('Your counsellor')"); await sleep(1000); await act(pg, "TUT.click();chOpen('c1')"); } },
  ],
};

const PARTNER = {
  role: 'partner',
  card: { eye: 'Orbuni guide · for partner agencies', h: 'The partner portal, <em>step by step</em>', p: 'Refer students, follow every application, find programmes and scholarships, and get paid — with your own AI assistant on Growth and up.',
          chap: ['Dashboard', 'Add a student', 'My students', 'Applications', 'Programme search', 'Scholarships', 'Commission', 'Your plan', 'Your assistant'], r: 'myorbuni.com/#partner' },
  outro: { eye: 'Ready when you are', h: 'Grow with <em>Orbuni</em>', p: 'Questions: message us in Talk to Orbuni, or WhatsApp +1 443 448 1577. Get the blue tick in Settings → Your plan.', r: 'VERIFIED30 · 30% off your first month' },
  chapters: [
    { t: 'Your dashboard', s: 'Students referred, live applications and enrolments — your real numbers, never estimates. The blue tick shows your plan.', dur: 8000,
      run: async (pg) => { await go(pg, "pGo('home')"); await sleep(1100); await act(pg, "TUT.move('Verified Growth');TUT.ring(document.querySelector('.vp-strip'),6)"); await sleep(3000); await act(pg, "TUT.move('Students referred');TUT.ring('Students referred',30)"); } },
    { t: 'Add a student', s: 'Name, email and WhatsApp first, then details, academics, programme and documents. They get their own login to follow along.', dur: 9000,
      run: async (pg) => { await act(pg, "TUT.noring();TUT.move('Add a student')"); await sleep(900); await act(pg, "TUT.click()"); await go(pg, "pGo('add')"); await sleep(1200);
        const vals = ['Halima', 'Sani', 'halima.sani@example.com', '+234 803 555 0142'];
        for (let n = 0; n < vals.length; n++) {
          const v = vals[n], sel = "document.querySelectorAll('#p-live input:not([type=hidden]):not([type=checkbox])')[" + n + "]";
          await act(pg, "TUT.move(" + sel + ");var e=" + sel + ";e&&e.focus()"); await sleep(600);
          for (let k = 1; k <= v.length; k += 2) { await act(pg, "var e=" + sel + "; if(e) e.value=" + JSON.stringify(v.slice(0, k))); await sleep(40); }
          await act(pg, "var e=" + sel + "; if(e) e.value=" + JSON.stringify(v)); await sleep(200);
        } await act(pg, "TUT.move('Next')"); } },
    { t: 'My students', s: 'Everyone you referred, their first choice and where it stands. Filter by applied, has an offer, enrolled or not applied yet.', dur: 8000,
      run: async (pg) => { await go(pg, "pGo('students')"); await sleep(1200); await act(pg, "TUT.move('Has an offer');TUT.ring('Has an offer',4)"); await sleep(2800); await act(pg, "TUT.move('Amina Yusuf');TUT.ring(TUT.find('Amina Yusuf')&&TUT.find('Amina Yusuf').closest('tr,.row,[onclick]'),4)"); } },
    { t: 'Applications', s: 'Each application is a card with its progress — applied, reviewed, offer, registered. Offers show the moment they arrive.', dur: 8000,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "pGo('apps')"); await sleep(1300); await act(pg, "TUT.move('Offers');TUT.ring('Offers',4)"); await sleep(2800); await act(pg, "TUT.move('Offer received');TUT.ring('Offer received',6)"); } },
    { t: 'Programme search', s: 'The same catalogue students see, with real published fees and discounts. Filter, then refer a student in one click.', dur: 8500,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "pGo('search')"); await sleep(1200); await act(pg, "TUT.move('Any degree');TUT.ring('Any degree',4)"); await sleep(2400); await act(pg, "TUT.move('Refer a student for this');TUT.ring('Refer a student for this',6)"); } },
    { t: '100% scholarships', s: 'Live scholarship places and the one price the student pays. Places are limited — the number left is on each card.', dur: 7500,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "pGo('schol')"); await sleep(1200); await act(pg, "TUT.move('4 places left');TUT.ring('4 places left',6)"); } },
    { t: 'Your commission', s: 'Recorded by itself when Orbuni records a payment from your student, and paid after the student registers at the university.', dur: 7500,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "pGo('comm')"); await sleep(1200); await act(pg, "TUT.move('Commission earned');TUT.ring('Commission earned',40)"); } },
    { t: 'Your plan and the blue tick', s: 'Verified, Growth, Pro or Max. Pay on Whop and it switches on by itself — 30% off your first month with VERIFIED30.', dur: 10000,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "pGo('settings')"); await sleep(1500); await act(pg, "TUT.move('Lagos Study Hub',0,0);TUT.ring(document.querySelector('.vp-preview'),6)"); await sleep(2600);
        await act(pg, "TUT.ring(document.querySelector('.vp-on'),0);TUT.move('Switched on for you')"); await sleep(2600); await act(pg, "document.querySelector('#p-sheet-body')&&document.querySelector('#p-sheet-body').scrollBy({top:420,behavior:'smooth'})"); await sleep(900); await act(pg, "TUT.noring();TUT.move(document.querySelectorAll('.vp-tabs button')[2])"); await sleep(1000); await act(pg, "TUT.click(document.querySelectorAll('.vp-tabs button')[2])"); } },
    { t: 'Your own Orbuni assistant', s: 'On Growth and up, press the Orbuni button and ask about your students, programmes, or a message to a parent.', dur: 12000,
      run: async (pg) => { await act(pg, "TUT.noring();pSheetDismiss&&pSheetDismiss()"); await sleep(600); await act(pg, "TUT.move('#ol-btn')"); await sleep(900); await act(pg, "TUT.click();olToggle(true)"); await sleep(2000); await act(pg, "TUT.move('Ask Orbuni')"); await sleep(900);
        await act(pg, "TUT.click();olToggle(false);askOpen('partner')"); await sleep(1400); await act(pg, "TUT.move('Who is missing documents?')"); await sleep(900);
        await act(pg, `TUT.click(); var T=window.__T.ask(); T.history.partner=[{role:'user',text:'Who is missing documents?'},{role:'assistant',text:'',live:true}]; window.__T.render();`);
        const reply = "Good afternoon, Amina. Two students need something from you:\n\n- **Chinedu Okafor** — transcript and school certificate are missing, so Medicine at Medipol can't move yet.\n- **Fatima Bello** — passport, passport photo and transcript are missing, and her Nursing application isn't sent.\n\n**Amina Yusuf** is complete and already has an offer from Istinye. Want me to write a WhatsApp message to Chinedu's parents?";
        for (let k = 8; k <= reply.length + 8; k += 9) { await act(pg, "var T=window.__T.ask(); var m=T.history.partner[1]; m.text=" + JSON.stringify(reply) + ".slice(0," + k + "); window.__T.render();"); await sleep(55); }
        await act(pg, "var T=window.__T.ask(); var m=T.history.partner[1]; m.live=false; m.steps=[{tool:'my_students',label:'your students'}]; window.__T.render();"); } },
  ],
};

const TEAM = {
  role: 'team',
  card: { eye: 'Orbuni guide · for the team', h: 'The team portal, <em>in two minutes</em>', p: 'Your day, your leads, WhatsApp, students, money — and an assistant that does the whole job from one message.',
          chap: ['Today', 'Leads', 'WhatsApp inbox', 'Students', 'Money', 'Ask Orbuni', 'The Orbuni button'], r: 'Team only · your own access' },
  outro: { eye: 'That is the tour', h: 'Let\'s get students <em>placed</em>', p: 'Each teammate sees only the sections the owner opens for them. Questions: ask Orbuni, or post in Spaces.', r: 'myorbuni.com' },
  chapters: [
    { t: 'Today: your day at a glance', s: 'What is late, what is waiting, and the one thing on you right now. Start every day here.', dur: 9000,
      run: async (pg) => { await go(pg, "aGo('today')"); await sleep(1200); await act(pg, "TUT.move('On you right now');TUT.ring(TUT.find('On you right now')&&TUT.find('On you right now').closest('div[class]'),8)"); await sleep(3200); await act(pg, "TUT.move('4 leads assigned to you');TUT.ring('4 leads assigned to you',6)"); } },
    { t: 'Leads arrive scored and assigned', s: 'Every enquiry is scored A to D and handed to a teammate automatically. Mine shows yours, oldest first.', dur: 9500,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('leads')"); await sleep(1300); await act(pg, "TUT.move('Mine 4');TUT.ring('Mine 4',6)"); await sleep(2800); await act(pg, "TUT.move('Ibrahim Musa');TUT.ring(TUT.find('Ibrahim Musa')&&TUT.find('Ibrahim Musa').closest('[class*=row],[class*=card],li,tr'),6)"); } },
    { t: 'WhatsApp: the AI answers, you step in', s: 'The AI replies to students day and night. When someone needs a person, the chat moves to Needs you.', dur: 11000,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('wa')"); await sleep(1500); await act(pg, "TUT.move('Needs you 1');TUT.ring('Needs you 1',6)"); await sleep(2600); await act(pg, "TUT.noring();TUT.move('Ibrahim Musa')"); await sleep(900); await act(pg, "TUT.click();var r=TUT.find('Ibrahim Musa');r&&(r.closest('.wa2-row')||r).click()"); await sleep(1800); await act(pg, "TUT.move('Can I pay the deposit in two parts?');TUT.ring('Can I pay the deposit in two parts?',8)"); } },
    { t: 'Students and their files', s: 'Every student, how complete their file is, their choices and their counsellor. Open a file to check documents.', dur: 8500,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('students')"); await sleep(1500); await act(pg, "TUT.move('File complete');TUT.ring('File complete',6)"); await sleep(2600); await act(pg, "TUT.move('Amina Yusuf');TUT.ring(TUT.find('Amina Yusuf')&&TUT.find('Amina Yusuf').closest('tr,[class*=row]'),4)"); } },
    { t: 'Money at a glance', s: 'Money in, money out and profit, live from the ledger. Every Whop and naira payment lands here by itself.', dur: 9000,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('finance')"); await sleep(1800); await act(pg, "TUT.move('#fd-kpis');TUT.ring('#fd-kpis',8)"); await sleep(3000); await act(pg, "TUT.move('Latest transactions');TUT.ring(TUT.find('Latest transactions')&&TUT.find('Latest transactions').closest('.fd-card'),6)"); } },
    { t: 'Ask Orbuni: one message, the whole job', s: 'Ask in plain words. Orbuni looks things up, drafts every step, and waits for your OK before anything happens.', dur: 15000,
      run: async (pg) => { await act(pg, "TUT.noring();aGo('students')"); await sleep(800); await act(pg, "TUT.move('#ol-btn')"); await sleep(900); await act(pg, "TUT.click();olToggle(true)"); await sleep(1600); await act(pg, "TUT.move('Ask Orbuni')"); await sleep(800);
        await act(pg, "TUT.click();olToggle(false);askOpen('students')"); await sleep(1300);
        const q = 'For Amina Yusuf: check what is missing, apply her to Software Engineering at Yeditepe, and email her an update.';
        await act(pg, `var T=window.__T.ask(); T.history.students=[{role:'user',text:${JSON.stringify(q)}},{role:'assistant',text:'',live:true,think:true,steps:[]}]; window.__T.render();`); await sleep(1300);
        await act(pg, "var T=window.__T.ask(); var m=T.history.students[1]; m.steps=[{label:'a student\\'s file'},{label:'programmes'}]; m.status='programmes'; window.__T.render();"); await sleep(900);
        const reply = "Done — everything is drafted for your OK.\n\n**Amina's file:** passport, transcript and certificate are verified. Her **passport photo** is uploaded and waiting for a check.\n\nWaiting for your OK:\n1. Apply Amina to **Software Engineering at Yeditepe** — $2,750 a year after her 50% scholarship.\n2. An email telling her the application is going in, and asking her to check her photo.";
        for (let k = 10; k <= reply.length + 10; k += 11) { await act(pg, "var T=window.__T.ask(); var m=T.history.students[1]; m.think=false; m.text=" + JSON.stringify(reply) + ".slice(0," + k + "); window.__T.render();"); await sleep(55); }
        await act(pg, `var T=window.__T.ask(); var th=T.history.students; th[1].live=false;
          th.push({kind:'proposal', draftId:'dA', status:'proposed', proposal:{ action:'add_application', student_name:'Amina Yusuf', items:[{programme_id:102, choice_rank:3, label:'Software Engineering · Bachelor · English — Yeditepe University'}], skipped:[], held:2, summary:'Apply Amina Yusuf to Software Engineering — Yeditepe University' }});
          th.push({kind:'proposal', draftId:'dB', status:'proposed', proposal:{ action:'send_email', recipient_type:'student', recipient_name:'Amina Yusuf', to_email:'amina.yusuf@example.com', subject:'Your Yeditepe application is going in', body:'Hello Amina, good news — we are applying for Software Engineering at Yeditepe…', summary:'Email Amina Yusuf: Your Yeditepe application is going in' }});
          T.drafts=T.drafts||{}; T.drafts.dA={proposal:th[2].proposal}; T.drafts.dB={proposal:th[3].proposal}; window.__T.render();
          var b=document.querySelector('#ask-thread, #askuni-panel .ask-body, #askuni-panel'); var sc=document.querySelector('#askuni-panel .ask-thread, #ask-thread'); if(sc) sc.scrollTop=sc.scrollHeight;`);
        await sleep(1200); await act(pg, "TUT.move('Approve');TUT.ring(document.querySelector('#askuni-panel .ask-card'),6)"); } },
    { t: 'The Orbuni button, wherever you like', s: 'Drag it to any corner. On a computer, Keep Orbuni on top floats it over your other apps.', dur: 9000,
      run: async (pg) => { await act(pg, "TUT.noring();askClose&&askClose();var p=document.getElementById('askuni-panel');p&&p.classList.remove('on')"); await sleep(700);
        await act(pg, "TUT.move('#ol-btn')"); await sleep(900);
        await act(pg, "var r=document.getElementById('ol-root');r.classList.add('ol-dragging');r.style.transition='left 1.1s cubic-bezier(.45,.05,.25,1),top 1.1s cubic-bezier(.45,.05,.25,1)';var b=r.getBoundingClientRect();r.style.left=b.left+'px';r.style.top=b.top+'px';r.style.right='auto';r.style.bottom='auto';setTimeout(function(){r.style.left='24px';r.style.top='170px';var c=document.getElementById('tut-cur');c.style.left='51px';c.style.top='197px';},60)"); await sleep(1500);
        await act(pg, "var r=document.getElementById('ol-root');r.classList.remove('ol-dragging');r.style.transition='';try{localStorage.setItem('orb-ol-pos',JSON.stringify({side:'left',y:197/innerHeight}))}catch(e){};olpApply()"); await sleep(800);
        await act(pg, "TUT.click();olToggle(true)"); await sleep(1500); await act(pg, "var it=[].slice.call(document.querySelectorAll('#ol-root .ol-it')).pop();TUT.move(it);TUT.ring(it,6)"); } },
  ],
};


const SC = (txt) => "var e=[].slice.call(document.querySelectorAll('button,b,h3,span,div,td')).filter(function(x){return (x.textContent||'').trim().indexOf(" + JSON.stringify(txt) + ")===0}).sort(function(a,b){return a.textContent.length-b.textContent.length})[0]; e&&e.scrollIntoView({block:'center',behavior:'smooth'})";
const TEAM2 = {
  role: 'team', titleDur: 7600, outroDur: 5200,
  card: { eye: 'Orbuni guide · for the team', h: 'The team portal, <em>the full tour</em>', p: 'Every section, what it is for, and what you do there — from your first lead to the partner payout.',
          chap: ['Today', 'Spaces', 'WhatsApp', 'Challenges', 'Leads', 'Create a student', 'Students', 'Applications', 'Documents', 'AskUni', 'Partners', 'Finance', 'Payouts', 'My earnings', 'Team & alerts', 'Ask Orbuni', 'The button'], r: 'Team only · your own access' },
  outro: { eye: 'That is the full tour', h: 'Let\'s get students <em>placed</em>', p: 'Each teammate sees only the sections the owner opens for them. Questions: ask Orbuni, or post in Spaces.', r: 'myorbuni.com' },
  chapters: [
    { t: 'Today: your day at a glance', s: 'What is late, what is waiting, and the one thing on you right now.', dur: 14169,
      run: async (pg) => { await go(pg, "aGo('today')"); await sleep(1200); await act(pg, "TUT.move('On you right now');TUT.ring(TUT.find('On you right now')&&TUT.find('On you right now').closest('div[class]'),8)"); await sleep(4200); await act(pg, "TUT.move('Create a student');TUT.ring(TUT.find('Create a student')&&TUT.find('Create a student').closest('[onclick],button,a,div[class]'),6)"); await sleep(2400); await act(pg, "TUT.move('Finance');TUT.ring(TUT.find('Finance')&&TUT.find('Finance').closest('[onclick],button,a,div[class]'),6)"); } },
    { t: 'Spaces: where the team talks', s: 'Teammates, departments and each student\'s own room — every conversation in one place.', dur: 9754,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('chat')"); await sleep(1400); await act(pg, "TUT.move('Departments');TUT.ring('Departments',8)"); await sleep(2600); await act(pg, "TUT.move('Your counsellor');TUT.ring(TUT.find('Your counsellor')&&TUT.find('Your counsellor').closest('[onclick],div[class]'),6)"); } },
    { t: 'WhatsApp: the AI answers, you step in', s: 'When someone needs a person, the chat moves to Needs you.', dur: 11374,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('wa')"); await sleep(1500); await act(pg, "TUT.move('Needs you 1');TUT.ring('Needs you 1',6)"); await sleep(2600); await act(pg, "TUT.noring();TUT.move('Ibrahim Musa')"); await sleep(900); await act(pg, "TUT.click();var r=TUT.find('Ibrahim Musa');r&&(r.closest('.wa2-row')||r).click()"); await sleep(1800); await act(pg, "TUT.move('Can I pay the deposit in two parts?');TUT.ring('Can I pay the deposit in two parts?',8)"); } },
    { t: 'Challenges: student cashback', s: 'Small rewards for completing the file, applying and enrolling — and what it costs.', dur: 11478,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('chall')"); await sleep(1500); await act(pg, "TUT.move('The three challenges');TUT.ring('The three challenges',8)"); await sleep(3000); await act(pg, "TUT.move('Get your file complete');TUT.ring(TUT.find('Get your file complete')&&TUT.find('Get your file complete').closest('div[class]'),6)"); } },
    { t: 'Leads arrive scored and assigned', s: 'Scored A to D and handed out automatically. Overdue leads turn red.', dur: 11426,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('leads')"); await sleep(1300); await act(pg, "TUT.move('Mine 4');TUT.ring('Mine 4',6)"); await sleep(3000); await act(pg, "TUT.move('Esther Adeyemi');TUT.ring(TUT.find('Esther Adeyemi')&&TUT.find('Esther Adeyemi').closest('[class*=card],[class*=row],li,tr,div[class]'),6)"); } },
    { t: 'Create a student', s: 'Contact first, then details, academics, programme and documents. They get their own login.', dur: 12497,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('create')"); await sleep(1300);
        const vals = ['Halima', 'Sani', 'halima.sani@example.com', '+234 803 555 0142'];
        for (let n = 0; n < vals.length; n++) {
          const v = vals[n], sel = "document.querySelectorAll('#a-live input:not([type=hidden]):not([type=checkbox])')[" + n + "]";
          await act(pg, "TUT.move(" + sel + ");var e=" + sel + ";e&&e.focus()"); await sleep(500);
          for (let k = 1; k <= v.length; k += 2) { await act(pg, "var e=" + sel + "; if(e) e.value=" + JSON.stringify(v.slice(0, k))); await sleep(40); }
          await act(pg, "var e=" + sel + "; if(e) e.value=" + JSON.stringify(v)); await sleep(200);
        } await act(pg, "TUT.move('Next');TUT.ring('Next',6)"); } },
    { t: 'Students and their files', s: 'Every file, how complete it is, choices and counsellor.', dur: 9937,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('students')"); await sleep(1500); await act(pg, "TUT.move('File complete');TUT.ring('File complete',6)"); await sleep(2600); await act(pg, "TUT.move('Amina Yusuf');TUT.ring(TUT.find('Amina Yusuf')&&TUT.find('Amina Yusuf').closest('tr,[class*=row]'),4)"); } },
    { t: 'Applications', s: 'Every programme applied to, its deadline and its status.', dur: 10120,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('apps')"); await sleep(1500); await act(pg, "TUT.move('Offer in');TUT.ring('Offer in',6)"); await sleep(2600); await act(pg, "TUT.move('Medicine');TUT.ring(TUT.find('Medicine')&&TUT.find('Medicine').closest('tr,[class*=row]'),4)"); } },
    { t: 'Documents to check', s: 'Open it, check the name matches, press Verify. Nothing goes out unchecked.', dur: 11426,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('docs')"); await sleep(1500); await act(pg, "TUT.move('Passport photo');TUT.ring(TUT.find('Passport photo')&&TUT.find('Passport photo').closest('tr,[class*=row],div[class]'),6)"); await sleep(3000); await act(pg, "TUT.move('Verify');TUT.ring('Verify',6)"); } },
    { t: 'The AskUni pipeline', s: 'Checked every 15 minutes: offers, missing documents and commission.', dur: 10590,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('askuni')"); await sleep(1500); await act(pg, "TUT.move('offers and acceptances');TUT.ring(TUT.find('offers and acceptances')&&TUT.find('offers and acceptances').closest('div[class]'),8)"); await sleep(3000); await act(pg, "TUT.move('commission still to come');TUT.ring(TUT.find('commission still to come')&&TUT.find('commission still to come').closest('div[class]'),8)"); } },
    { t: 'Partner agencies', s: 'Check every request, approve, and see their students and commission owed.', dur: 11792,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('partners')"); await sleep(1500); await act(pg, "TUT.move('Waiting for you');TUT.ring(TUT.find('Waiting for you')&&TUT.find('Waiting for you').closest('div[class]'),6)"); await sleep(2800); await act(pg, "TUT.move('Commission owed');TUT.ring(TUT.find('Commission owed')&&TUT.find('Commission owed').closest('div[class]'),6)"); await sleep(2200); await act(pg, "TUT.move('Lagos Study Hub');TUT.ring(TUT.find('Lagos Study Hub')&&TUT.find('Lagos Study Hub').closest('div[class]'),6)"); } },
    { t: 'Finance: money at a glance', s: 'Money in, money out and profit, live from the ledger.', dur: 11243,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('finance')"); await sleep(1800); await act(pg, "TUT.move('#fd-kpis');TUT.ring('#fd-kpis',8)"); await sleep(3200); await act(pg, "TUT.move('Where income comes from');TUT.ring(TUT.find('Where income comes from')&&TUT.find('Where income comes from').closest('.fd-card,div[class]'),6)"); } },
    { t: 'Paying partner commission', s: 'Pending until the student registers. Pay the partner, then press Mark paid.', dur: 13385,
      run: async (pg) => { await act(pg, "TUT.noring();TUT.move('Waiting to be paid out');TUT.ring(TUT.find('Waiting to be paid out')&&TUT.find('Waiting to be paid out').closest('.fd-card,div[class]'),6)"); await sleep(3600); await act(pg, SC('Mark paid')); await sleep(1500); await act(pg, "TUT.move('Mark paid');TUT.ring(TUT.find('Mark paid')&&TUT.find('Mark paid').closest('tr'),4)"); await sleep(2600); await act(pg, "TUT.move('Mark paid');TUT.ring('Mark paid',6)"); } },
    { t: 'My earnings', s: 'What you have been paid, and what is on its way. Only your own.', dur: 7847,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('earn')"); await sleep(1500); await act(pg, "TUT.move('Your earnings');TUT.ring(TUT.find('Your earnings')&&TUT.find('Your earnings').closest('div[class]'),8)"); await sleep(2400); await act(pg, "TUT.move('What you have been paid for')"); } },
    { t: 'Team & alerts', s: 'Who sees what, and who gets told when something happens.', dur: 10538,
      run: async (pg) => { await act(pg, "TUT.noring()"); await go(pg, "aGo('team')"); await sleep(1500); await act(pg, "TUT.move('Godfrey Emmanuel');TUT.ring(TUT.find('Godfrey Emmanuel')&&TUT.find('Godfrey Emmanuel').closest('tr'),4)"); await sleep(3000); await act(pg, "TUT.move('Who gets told about what');TUT.ring(TUT.find('Who gets told about what')&&TUT.find('Who gets told about what').closest('div[class]'),6)"); } },
  ],
};
TEAM2.chapters.push(Object.assign({}, TEAM.chapters[5], {dur: 10512}), Object.assign({}, TEAM.chapters[6], {dur: 7952}));

const EV = []; let T0 = 0;
function logEv(js){ const t = Date.now() - T0; if(/TUT\.click\(/.test(js)) EV.push(['click', t]); if(/TUT\.ring\((?!\s*\))/.test(js) && !/TUT\.noring\(\);?$/.test(js)) EV.push(['ring', t]); if(/olToggle\(true\)/.test(js)) EV.push(['fan', t]); if(/e\.value=/.test(js) && !/e\.focus/.test(js)) EV.push(['key', t]); }
async function act(pg, js) { logEv(js); try { await pg.evaluate((s) => window.__T.ev(s), js); } catch (e) { console.warn('act failed:', js.slice(0, 80), e.message.slice(0, 120)); } }
async function go(pg, js) { await act(pg, js); }

(async () => {
  const S = which === 'partner' ? PARTNER : which === 'team2' ? TEAM2 : which === 'team' ? TEAM : STUDENT;
  if (timing) { S.titleDur = timing.title; S.outroDur = timing.outro; S.chapters.forEach((c, i) => { if (timing.ch[i]) c.dur = timing.ch[i]; }); }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, recordVideo: { dir: OUT + 'raw/', size: { width: 1280, height: 800 } } });
  const t0 = Date.now(); T0 = t0;
  const pg = await ctx.newPage();
  pg.errs = []; pg.on('pageerror', (e) => pg.errs.push(e.message));
  const dorms = fs.readdirSync(__dirname + '/dorms').filter((f) => f.startsWith('clean-')); let di = 0;
  await pg.route(/futurebuilders\.com\.tr/, (r) => r.fulfill({ path: __dirname + '/dorms/' + dorms[(di++) % dorms.length], contentType: 'image/png' }));
  await pg.route(/supabase\.co|cdn\.jsdelivr|unpkg|gstatic|googleapis|challenges\.cloudflare/, (r) => r.abort());
  await pg.goto('http://localhost:8765/_uitest.html', { waitUntil: 'domcontentloaded' });
  await pg.addScriptTag({ content: fs.readFileSync(__dirname + '/tut_overlay.js', 'utf8') });
  await pg.evaluate((o) => { TUT.card(o); }, S.card);
  const marks = { start: Date.now() - t0 };
  await pg.addScriptTag({ content: fs.readFileSync(__dirname + '/fake2.js', 'utf8') });
  await pg.addScriptTag({ content: fs.readFileSync(__dirname + '/fake3.js', 'utf8') });
  await sleep(700);
  await pg.evaluate((role) => {
    try{ localStorage.removeItem('orb-ol-pos'); localStorage.setItem('orb-ol-tip','1'); }catch(e){}
    if (role === 'team' || role === 'team2') {
      var f3 = window.__fake3();
      window.__T.set(f3, f3._me, { id:'u0', first_name:'Nurudeen', last_name:'Abdulkareem', role:'admin', is_owner:true, job_title:'Founder & Managing Director', email:'nurudeen@myorbuni.com' });
      document.getElementById('portal').classList.add('on'); document.getElementById('auth').style.display = 'none';
      document.getElementById('sh-admin').classList.add('on'); window.__T.ev("aGo('today')"); return;
    }
    var f = window.__fake2(role);
    var prof = role === 'partner' ? { id: 'u9', first_name: 'Amina', last_name: 'Bello', role: 'partner', partner_id: 'pa1', email: 'amina@lagosstudyhub.ng' }
      : { id: 's1', first_name: 'Amina', last_name: 'Yusuf', role: 'student', email: 'amina.yusuf@example.com', counsellor_id: 'u1', onboarding_step: 4 };
    window.__T.set(f, f._me, prof);
    document.getElementById('portal').classList.add('on');
    document.getElementById('auth').style.display = 'none';
    document.getElementById(role === 'partner' ? 'sh-partner' : 'sh-student').classList.add('on');
    if (role === 'partner') window.__T.ev("overridePartnerViews(); paintPartnerIdentity(); vpLoad(true); pGo('home')");
    else window.__T.ev("typeof paintStudentIdentity==='function'&&paintStudentIdentity(); sGo('track')");
  }, S.role);
  await sleep(Math.max(1500, (S.titleDur || 6500) - 700));
  await act(pg, 'TUT.uncard()');
  marks.titleEnd = Date.now() - t0;
  await sleep(700);
  marks.ch = [];
  for (let i = 0; i < S.chapters.length; i++) {
    const c = S.chapters[i], cs = Date.now();
    marks.ch.push(cs - t0);
    await pg.evaluate(([n, i, t, s]) => { TUT.dots(n, i); TUT.lt(i + 1, t, s); }, [S.chapters.length, i, c.t, c.s]);
    await c.run(pg);
    const left = c.dur - (Date.now() - cs); if (left > 0) await sleep(left);
  }
  await act(pg, 'TUT.nolt();TUT.nodots();TUT.noring();TUT.hidecur();olToggle&&olToggle(false)');
  await pg.evaluate((o) => TUT.card(o), S.outro);
  marks.outro = Date.now() - t0;
  await sleep(S.outroDur || 4500);
  marks.end = Date.now() - t0;
  const vpath = await pg.video().path();
  await ctx.close(); await b.close();
  fs.writeFileSync(OUT + which + '_marks.json', JSON.stringify({ video: vpath, marks, events: EV, errs: pg.errs.slice(0, 5) }, null, 1));
  console.log(JSON.stringify({ video: vpath, marks, errs: pg.errs.slice(0, 5) }));
})();
