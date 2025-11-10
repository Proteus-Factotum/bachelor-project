// rater.mjs — single-turn, minimal
import fs from 'node:fs';

if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

const EPISODES = Number(process.argv[2] ?? 10);
const WORDPACK = JSON.parse(fs.readFileSync('./wordpacks/english.json', 'utf8'));
const byId = Object.fromEntries(WORDPACK.map(x => [x.id, x]));

const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();

async function get(u){ const r=await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function post(u,b){ const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); if(!r.ok) throw new Error(await r.text()); return r.json(); }

async function guessWithGPT(hint, model='gpt-4o-mini'){
  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({
      model, temperature:0.3, top_p:1,
      messages:[
        {role:'system',content:'Given a hint, answer with exactly one lowercase English word.'},
        {role:'user',content:`Hint:\n${hint}\n\nAnswer with one word only:`}
      ]
    })
  });
  const j = await r.json();
  const raw = j.choices?.[0]?.message?.content?.trim() ?? '';
  return norm(raw.replace(/["'`]/g,'').split(/\s+/)[0]);
}

for (let i=1; i<=EPISODES; i++){
  try{
    const { target, word_id } = await get('http://localhost:3000/api/next-target');
    const item = byId[word_id]; if (!item) throw new Error(`word_id not in wordpack: ${word_id}`);
    const ALLOWED = new Set([item.target, ...(item.aliases||[])].map(norm));

    const { episode_id } = await post('http://localhost:3000/api/episode', { word_id, target });

    const t = await post('http://localhost:3000/api/hint', { episode_id, target });
    if (t.leak) {
      await post('http://localhost:3000/api/auto-reward', { episode_id, target, solved:false, guess:null });
      continue;
    }

    const guess = await guessWithGPT(t.hint_text);
    const solved = ALLOWED.has(norm(guess));

    await post('http://localhost:3000/api/auto-reward', { episode_id, target, solved, guess });
  } catch(e){
    console.error('Episode failed:', e.message || e);
  }
}
console.log('Done.');
