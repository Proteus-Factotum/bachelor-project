// api.mjs  — minimal single-turn version
import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const app = express();
app.use(express.json());

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Wordpack: [{ id, target, aliases[] }]
const WORDPACK = JSON.parse(fs.readFileSync('./wordpacks/english.json', 'utf8'));
const byId = Object.fromEntries(WORDPACK.map(x => [x.id, x]));

// Helpers
const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const tokCount = s => String(s||'').trim().split(/\s+/).filter(Boolean).length;
const strip = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const brevity = n => 1/(1 + (n/50)*Math.log(1+n));
function leaks(text, target, aliases=[]){
  const h=strip(text); for (const f of [target,...aliases].map(strip).filter(Boolean)){
    if (new RegExp(`\\b${f}\\b`,`i`).test(h)) return true;
  } return false;
}

// LLM hint (no history, single shot)
async function generateHint(target){
  const body = {
    model: 'mistral:latest',
    messages: [
      { role:'system', content: `Describe "${target}", without using the word "${target}"` },
      { role:'user',   content: `Target: ${target}\nWrite one short hint.` }
    ],
    stream:false,
    options:{ temperature:0.7 }
  };
  const r = await fetch('http://127.0.0.1:11434/api/chat',{
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  if(!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return j.message.content.trim();
}

// --- Endpoints ---

// 0) pick a target
app.get('/api/next-target', (_req,res)=>{
  const item = WORDPACK[Math.floor(Math.random()*WORDPACK.length)];
  res.json({ target:item.target, word_id:item.id });
});

// 1) create episode
app.post('/api/episode', async (req,res)=>{
  try{
    const { word_id, target } = req.body;
    if(!word_id || !target) return res.status(400).json({ error:'word_id, target required' });
    const item = byId[word_id]; if(!item) return res.status(400).json({ error:'word_id not in wordpack' });
    const { data: ep, error } = await supabase.from('episodes')
      .insert({ word_id, target, aliases: Array.isArray(item.aliases)?item.aliases:[], model_ckpt:'base' })
      .select().single();
    if(error) return res.status(400).json({ error:error.message });
    res.json({ episode_id: ep.id });
  }catch(e){ res.status(500).json({ error:String(e.message||e) }); }
});

// 2) generate ONE hint and store it on episodes
app.post('/api/hint', async (req,res)=>{
  try{
    const { episode_id, target } = req.body;
    if(!episode_id || !target) return res.status(400).json({ error:'episode_id, target required' });

    const { data: ep, error: epErr } = await supabase.from('episodes')
      .select('aliases, hint_text').eq('id', episode_id).single();
    if(epErr) return res.status(400).json({ error: epErr.message });
    if(ep.hint_text) return res.status(409).json({ error:'hint already exists' });

    const hint_text = await generateHint(target);
    const leaked = leaks(hint_text, target, ep.aliases);
    const tokens = tokCount(hint_text);

    const { error: upErr } = await supabase.from('episodes')
      .update({ hint_text, leaked, tokens, hint_created_at: new Date().toISOString() })
      .eq('id', episode_id);
    if(upErr) return res.status(400).json({ error: upErr.message });

    res.json({ hint_text, tokens, leak: leaked });
  }catch(e){ res.status(500).json({ error:String(e.message||e) }); }
});

// 3) auto reward (single-turn)
app.post('/api/auto-reward', async (req,res)=>{
  try{
    const { episode_id, target, solved=false, guess=null } = req.body;
    if(!episode_id || !target) return res.status(400).json({ error:'episode_id, target required' });

    const { data: ep, error: qErr } = await supabase.from('episodes')
      .select('hint_text, tokens, leaked, aliases').eq('id', episode_id).single();
    if(qErr) return res.status(400).json({ error:qErr.message });
    if(!ep.hint_text) return res.status(400).json({ error:'no hint for this episode' });

    const didLeak = ep.leaked || leaks(ep.hint_text, target, ep.aliases||[]);
    const tok = ep.tokens || tokCount(ep.hint_text);

    let reward, tag;
    if(didLeak){ reward=-1; tag='leak'; }
    else { reward = clamp(brevity(tok) + (solved?0.20:-0.20), -1, 1); tag = solved?'auto_len+solve':'auto_len'; }

    const { data: fb, error: fbErr } = await supabase.from('feedback')
      .insert({ episode_id, reward, tag, guess }).select().single();
    if(fbErr) return res.status(400).json({ error: fbErr.message });

    res.json({ feedback_id: fb.id, reward, tag, total_tokens: tok, didLeak, guess });
  }catch(e){ res.status(500).json({ error:String(e.message||e) }); }
});

app.listen(3000, ()=>console.log('api on :3000'));
