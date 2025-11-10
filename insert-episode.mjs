import 'dotenv/config'; // if using .mjs
// OR
// require('dotenv').config(); // if using .js (CommonJS)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server key, not anon
);

const row = {
  word_id: 'es-0000',
  native_en: 'test',
  model_ckpt: 'base',
};

const { data, error } = await supabase
  .from('episodes')
  .insert(row)
  .select()
  .single();

if (error) {
  console.error('Insert failed:', error);
  process.exit(1);
}

console.log('Inserted episode_id:', data.id);
